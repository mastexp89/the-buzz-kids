"use server";

// Live activity counters for the admin Control room widget. Reads from
// page_views and returns rolling counts that the client polls every ~30s.
//
// Heads-up: page_views has no session_id column, so "viewers" here actually
// means raw page views (one user clicking 5 pages = 5). For an admin-only
// pulse-check that's fine — we just label it accurately in the UI.

import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";

export type LiveActivity = {
  lastMinute: number;
  lastFiveMinutes: number;
  today: number;
  topVenue: { name: string; slug: string; citySlug: string | null; views: number } | null;
  topEvent: { title: string; id: string; venueSlug: string | null; citySlug: string | null; views: number } | null;
};

export async function getLiveActivity(): Promise<{ error: string } | { ok: true; data: LiveActivity }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };
  const { data: prof } = await supabase
    .from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (prof?.role !== "admin") return { error: "Admins only." };

  const sb = createServiceClient();
  const now = Date.now();
  const oneMinAgo = new Date(now - 60_000).toISOString();
  const fiveMinAgo = new Date(now - 5 * 60_000).toISOString();
  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);

  // Use head-only counts so we don't pull rows we don't need.
  const [{ count: lastMinute }, { count: lastFiveMinutes }, { count: today }] = await Promise.all([
    sb.from("page_views").select("id", { count: "exact", head: true }).gte("viewed_at", oneMinAgo),
    sb.from("page_views").select("id", { count: "exact", head: true }).gte("viewed_at", fiveMinAgo),
    sb.from("page_views").select("id", { count: "exact", head: true }).gte("viewed_at", todayStart.toISOString()),
  ]);

  // What's hot in the last 5 minutes — pull the rows + count in JS (small set).
  const { data: recent } = await sb
    .from("page_views")
    .select("venue_id, event_id")
    .gte("viewed_at", fiveMinAgo)
    .limit(1000);

  const venueCounts = new Map<string, number>();
  const eventCounts = new Map<string, number>();
  for (const r of recent ?? []) {
    if (r.venue_id) venueCounts.set(r.venue_id, (venueCounts.get(r.venue_id) ?? 0) + 1);
    if (r.event_id) eventCounts.set(r.event_id, (eventCounts.get(r.event_id) ?? 0) + 1);
  }

  let topVenue: LiveActivity["topVenue"] = null;
  let topEvent: LiveActivity["topEvent"] = null;

  if (venueCounts.size > 0) {
    const [vId, vViews] = [...venueCounts.entries()].sort((a, b) => b[1] - a[1])[0];
    const { data: v } = await sb
      .from("venues")
      .select("name, slug, city:cities(slug)")
      .eq("id", vId)
      .maybeSingle();
    if (v) {
      topVenue = {
        name: v.name,
        slug: v.slug,
        citySlug: (v.city as any)?.slug ?? null,
        views: vViews,
      };
    }
  }

  if (eventCounts.size > 0) {
    const [eId, eViews] = [...eventCounts.entries()].sort((a, b) => b[1] - a[1])[0];
    const { data: e } = await sb
      .from("events")
      .select("title, venue:venues(slug, city:cities(slug))")
      .eq("id", eId)
      .maybeSingle();
    if (e) {
      topEvent = {
        title: e.title,
        id: eId,
        venueSlug: (e.venue as any)?.slug ?? null,
        citySlug: (e.venue as any)?.city?.slug ?? null,
        views: eViews,
      };
    }
  }

  return {
    ok: true,
    data: {
      lastMinute: lastMinute ?? 0,
      lastFiveMinutes: lastFiveMinutes ?? 0,
      today: today ?? 0,
      topVenue,
      topEvent,
    },
  };
}
