"use server";

// Admin event search — find any event in the system by title / venue / artist
// and jump to its edit page. Useful for fixing wrong-venue assignments,
// correcting typos, deleting bad imports without going via the venue page.

import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";

async function requireAdmin() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: prof } = await supabase
    .from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (prof?.role !== "admin") return null;
  return { userId: user.id };
}

export type EventSearchResult = {
  id: string;
  title: string;
  start_time: string;
  status: string | null;
  cancelled: boolean;
  auto_imported_from: string | null;
  image_url: string | null;
  venue: { id: string; name: string; slug: string; city: string | null } | null;
  artists: string[];
};

export type EventSearchFilters = {
  query?: string;
  venueId?: string | null;
  // "upcoming" | "past" | "all" — defaults to upcoming so admins don't get drowned in old data
  when?: "upcoming" | "past" | "all";
  // "approved" | "pending" | "rejected" | "all" — defaults to all
  status?: "approved" | "pending" | "rejected" | "all";
  limit?: number;
};

export type EventSearchResponse = {
  results: EventSearchResult[];
  totalMatching: number; // total rows matching the filters (ignoring limit)
  capApplied: number;    // the limit we used — caller can show "X of Y, capped at Z"
};

export async function searchAllEvents(filters: EventSearchFilters = {}): Promise<EventSearchResponse> {
  if (!(await requireAdmin())) return { results: [], totalMatching: 0, capApplied: 0 };
  const sb = createServiceClient();

  const q = (filters.query ?? "").trim();
  const when = filters.when ?? "upcoming";
  const status = filters.status ?? "all";
  // Bumped cap from 100 to 500 — admin needs to see the full picture when
  // searching for cleanup work. Above 500 the table renders sluggishly.
  const limit = Math.min(500, filters.limit ?? 200);

  // Helper to apply the same filter clauses to either the list query or
  // the count query, so the totalMatching number reflects exactly what's
  // returned plus everything else hidden by the limit.
  function applyFilters<T extends ReturnType<typeof sb.from>>(req: T): T {
    let q2 = req as any;
    if (when === "upcoming") q2 = q2.gte("start_time", new Date().toISOString());
    else if (when === "past") q2 = q2.lt("start_time", new Date().toISOString());
    if (status !== "all") q2 = q2.eq("status", status);
    if (filters.venueId) q2 = q2.eq("venue_id", filters.venueId);
    if (q.length > 0) q2 = q2.ilike("title", `%${q.replace(/[%_]/g, "")}%`);
    return q2 as T;
  }

  // Total matching count (uses head + count for cheapness, no row data)
  const { count: totalMatching } = await applyFilters(
    sb.from("events").select("id", { count: "exact", head: true }) as any,
  );

  // Actual rows (with the limit applied)
  const baseList = sb
    .from("events")
    .select(`
      id, title, start_time, status, cancelled, auto_imported_from, image_url,
      venue:venues(id, name, slug, city:cities(name)),
      event_artists(artist:artists(name))
    `)
    .order("start_time", { ascending: when !== "past" })
    .limit(limit) as any;
  const { data } = await applyFilters(baseList);

  return {
    results: (data ?? []).map((e: any) => ({
      id: e.id,
      title: e.title,
      start_time: e.start_time,
      status: e.status ?? null,
      cancelled: !!e.cancelled,
      auto_imported_from: e.auto_imported_from ?? null,
      image_url: e.image_url ?? null,
      venue: e.venue
        ? { id: e.venue.id, name: e.venue.name, slug: e.venue.slug, city: e.venue.city?.name ?? null }
        : null,
      artists: (e.event_artists ?? [])
        .map((ea: any) => ea.artist?.name)
        .filter(Boolean),
    })),
    totalMatching: totalMatching ?? 0,
    capApplied: limit,
  };
}

export type AdminVenueOption = { id: string; name: string; slug: string; city: string | null };

export async function searchVenuesForFilter(query: string): Promise<AdminVenueOption[]> {
  if (!(await requireAdmin())) return [];
  const sb = createServiceClient();
  const q = query.trim();
  let req = sb
    .from("venues")
    .select("id, name, slug, city:cities(name)")
    .order("name")
    .limit(15);
  if (q.length > 0) req = req.ilike("name", `%${q.replace(/[%_]/g, "")}%`);
  const { data } = await req;
  return (data ?? []).map((v: any) => ({
    id: v.id,
    name: v.name,
    slug: v.slug,
    city: v.city?.name ?? null,
  }));
}
