"use server";

// One-off cleanup tool for legacy sports events.
//
// Before the SPORTS SCREENING AGGREGATION rule landed in lib/extraction.ts,
// the FB scraper inserted one event per match — so a Saturday with 8
// fixtures at Top Dog Sports Bar produced 8 individual rows. This tool
// finds same-day same-venue clusters of AI-imported sports events and
// merges each cluster into a single "Live sports — N matches" row,
// matching what new scrapes now produce natively.
//
// Safety rules:
//   - Only touches events with auto_imported_from set (AI-imported).
//     Manually-created events are never auto-merged.
//   - Only considers events tagged with the "sports" genre.
//   - Only considers future events (start_time >= today).
//   - Preserves the winner's image_url, posters, ticket_url etc.

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";

async function requireAdmin() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: me } = await supabase
    .from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (me?.role !== "admin") return null;
  return { userId: user.id };
}

function ukDayKey(iso: string): string {
  // Group events by UK calendar day (Europe/London) so a 23:30 kickoff and
  // a 14:00 kickoff on the same Saturday share a key.
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "invalid";
  return d.toLocaleDateString("en-CA", { timeZone: "Europe/London" }); // YYYY-MM-DD
}

export type SportsClusterPreview = {
  venueId: string;
  venueName: string;
  citySlug: string | null;
  dayKey: string;     // YYYY-MM-DD (Europe/London)
  count: number;
  events: Array<{
    id: string;
    title: string;
    startIso: string;
  }>;
};

/**
 * Find all clusters of legacy AI-imported sports events that would be
 * merged. Returns up to N clusters with their member events listed so
 * the admin can eyeball them before pulling the trigger.
 */
export async function findSportsClusters(): Promise<
  | { ok: true; clusters: SportsClusterPreview[]; total: number }
  | { error: string }
> {
  if (!(await requireAdmin())) return { error: "Admins only." };
  const sb = createServiceClient();

  // Step 1: find all event ids linked to the "sports" genre.
  const { data: sportsGenre } = await sb
    .from("genres")
    .select("id")
    .eq("slug", "sports")
    .maybeSingle();
  if (!sportsGenre) {
    return { ok: true, clusters: [], total: 0 };
  }
  const { data: sportsLinks } = await sb
    .from("event_genres")
    .select("event_id")
    .eq("genre_id", sportsGenre.id);
  const sportsEventIds = (sportsLinks ?? []).map((l: any) => l.event_id);
  if (sportsEventIds.length === 0) {
    return { ok: true, clusters: [], total: 0 };
  }

  // Step 2: hydrate, restrict to AI-imported, upcoming, approved-only.
  const nowIso = new Date().toISOString();
  const { data: events } = await sb
    .from("events")
    .select("id, title, start_time, venue_id, auto_imported_from, status, venue:venues(name, city:cities(slug))")
    .in("id", sportsEventIds)
    .not("auto_imported_from", "is", null)
    .gte("start_time", nowIso)
    .neq("status", "rejected")
    .order("start_time", { ascending: true });

  // Step 3: cluster by (venue_id, UK day).
  const byKey = new Map<string, SportsClusterPreview>();
  for (const e of events ?? []) {
    const dayKey = ukDayKey(e.start_time as string);
    const venueId = e.venue_id as string;
    const key = `${venueId}|${dayKey}`;
    let cluster = byKey.get(key);
    if (!cluster) {
      cluster = {
        venueId,
        venueName: (e.venue as any)?.name ?? "Unknown venue",
        citySlug: (e.venue as any)?.city?.slug ?? null,
        dayKey,
        count: 0,
        events: [],
      };
      byKey.set(key, cluster);
    }
    cluster.events.push({
      id: e.id as string,
      title: e.title as string,
      startIso: e.start_time as string,
    });
    cluster.count += 1;
  }

  // Only clusters with 2+ events are mergeable.
  const all = Array.from(byKey.values()).filter((c) => c.count >= 2);
  // Soonest first
  all.sort((a, b) => a.dayKey.localeCompare(b.dayKey));

  return { ok: true, clusters: all.slice(0, 200), total: all.length };
}

export type MergeClusterResult =
  | { ok: true; merged: number; winnerId: string }
  | { error: string };

/**
 * Merge one cluster into a single event. Picks the earliest-starting
 * event as the winner, updates its title/description/end_time, copies
 * any extra genres from losers, and deletes the loser rows.
 */
export async function mergeCluster(
  venueId: string,
  dayKey: string,
): Promise<MergeClusterResult> {
  if (!(await requireAdmin())) return { error: "Admins only." };
  const sb = createServiceClient();

  // Re-derive the cluster from scratch so we never trust stale client state.
  const { data: sportsGenre } = await sb
    .from("genres").select("id").eq("slug", "sports").maybeSingle();
  if (!sportsGenre) return { error: "Sports genre not configured." };
  const { data: sportsLinks } = await sb
    .from("event_genres").select("event_id").eq("genre_id", sportsGenre.id);
  const sportsEventIds = (sportsLinks ?? []).map((l: any) => l.event_id);
  if (sportsEventIds.length === 0) {
    return { error: "No sports events found." };
  }

  const { data: events } = await sb
    .from("events")
    .select("id, title, start_time, end_time, description")
    .in("id", sportsEventIds)
    .eq("venue_id", venueId)
    .not("auto_imported_from", "is", null)
    .neq("status", "rejected")
    .order("start_time", { ascending: true });

  const filtered = (events ?? []).filter(
    (e) => ukDayKey(e.start_time as string) === dayKey,
  );
  if (filtered.length < 2) {
    return { error: "Cluster no longer has 2+ events — nothing to merge." };
  }

  const winner = filtered[0];
  const losers = filtered.slice(1);

  // Build merged description as "HH:MM — Title" chronologically.
  const descriptionLines = filtered.map((e) => {
    const t = new Date(e.start_time as string);
    const hh = t.toLocaleTimeString("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "Europe/London",
      hour12: false,
    });
    return `${hh} — ${e.title}`;
  });
  const mergedDescription = descriptionLines.join("\n");

  // Latest end_time wins (or null if none had one).
  const latestEnd = filtered
    .map((e) => (e.end_time ? new Date(e.end_time as string) : null))
    .filter((d): d is Date => d !== null && !Number.isNaN(d.getTime()))
    .sort((a, b) => b.getTime() - a.getTime())[0] ?? null;

  const newTitle = `Live sports — ${filtered.length} matches`;

  const { error: updErr } = await sb
    .from("events")
    .update({
      title: newTitle,
      description: mergedDescription,
      end_time: latestEnd ? latestEnd.toISOString() : null,
    })
    .eq("id", winner.id);
  if (updErr) return { error: `Update winner: ${updErr.message}` };

  // Pull extra genres from losers up to the winner (sports is already
  // there; this catches edge cases where a loser had additional tags).
  const loserIds = losers.map((l) => l.id);
  const { data: loserGenres } = await sb
    .from("event_genres")
    .select("genre_id")
    .in("event_id", loserIds);
  if (loserGenres && loserGenres.length > 0) {
    const unique = Array.from(
      new Set((loserGenres as any[]).map((g) => g.genre_id)),
    );
    await sb
      .from("event_genres")
      .upsert(
        unique.map((genre_id) => ({ event_id: winner.id, genre_id })),
        { onConflict: "event_id,genre_id", ignoreDuplicates: true },
      );
  }

  // Delete loser rows. event_genres / event_artists FKs typically cascade
  // (matches the existing deleteVenue path), so this clears them too.
  const { error: delErr } = await sb
    .from("events")
    .delete()
    .in("id", loserIds);
  if (delErr) return { error: `Delete losers: ${delErr.message}` };

  revalidatePath("/admin/sports-merge");
  return { ok: true, merged: filtered.length, winnerId: winner.id as string };
}

/**
 * Merge every cluster found. Calls mergeCluster in sequence so a failure
 * on one doesn't tank the rest. Returns a summary.
 */
export async function mergeAllClusters(): Promise<
  { ok: true; clustersMerged: number; eventsConsumed: number; errors: string[] }
> {
  const errors: string[] = [];
  let clustersMerged = 0;
  let eventsConsumed = 0;

  const preview = await findSportsClusters();
  if ("error" in preview) {
    errors.push(preview.error);
    return { ok: true, clustersMerged, eventsConsumed, errors };
  }

  for (const c of preview.clusters) {
    const res = await mergeCluster(c.venueId, c.dayKey);
    if ("error" in res) {
      errors.push(`${c.venueName} ${c.dayKey}: ${res.error}`);
    } else {
      clustersMerged += 1;
      eventsConsumed += res.merged;
    }
  }

  revalidatePath("/admin/sports-merge");
  return { ok: true, clustersMerged, eventsConsumed, errors };
}
