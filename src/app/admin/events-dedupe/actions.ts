"use server";

// Find + merge duplicate events. Looser net than the nightly
// /api/cron/dedupe-events run — that one groups by venue + start-hour
// and only catches near-identical titles. This tool groups by venue +
// calendar day so admin can manually merge cases that fall outside
// the cron's window (e.g. festival schedule got entered twice with
// times slightly off, or one entry says "Pure Sound 12:00" and the
// other "Pure Sound — Bandstand 12:30").
//
// Scope: optional festival filter via festival_id. Without it we sweep
// all upcoming events in the next 90 days.
//
// Merge re-points every child row (event_artists / event_organisers /
// event_genres / favourites pointing at the loser as a target_id),
// fills blank fields on the winner from the losers, then deletes the
// loser rows. notifications_sent + page_views cascade-delete via FK.

import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { revalidatePath } from "next/cache";

async function requireAdmin() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: prof } = await supabase
    .from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (prof?.role !== "admin") return null;
  return { userId: user.id };
}

function normaliseTitle(t: string): string {
  return String(t || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

// Strip aggregation count suffixes so titles that only differ in the
// rolling match-count cluster together. e.g.
//   "LIVE SPORTS — 7 MATCHES" → "LIVE SPORTS"
//   "LIVE SPORTS — 8 MATCHES" → "LIVE SPORTS"
// Both then collapse to the same dedupe key and get clustered.
// Handles em-dash, en-dash, hyphen, " x" separators and singular/plural.
function stripCountSuffix(t: string): string {
  return String(t || "")
    .replace(/\s*[–—\-:|·]\s*\d+\s*(match(?:es)?|games?|fixtures?|events?)\s*$/i, "")
    .replace(/\s*\(\s*\d+\s*(match(?:es)?|games?|fixtures?|events?)\s*\)\s*$/i, "")
    .trim();
}

// Dedupe key = normalised + stripped. Used only for clustering decisions;
// elsewhere we keep the raw normalised form (for group keys, display, etc).
function dedupeKey(t: string): string {
  return normaliseTitle(stripCountSuffix(t));
}

// Tokens used to detect "generic placeholder" titles that should always
// lose to a specific title at the same venue+day. Copy-paste from the
// dedupe-events cron so the two stay aligned.
const GENERIC_TITLE_TOKENS = [
  "livemusic", "liveband", "livesports", "karaoke", "openmic", "openmicnight",
  "pubquiz", "quiznight", "djset", "djnight", "discoteque",
  "comedynight", "tribute", "live",
];

function isGenericTitle(title: string): boolean {
  const nt = normaliseTitle(stripCountSuffix(title));
  if (nt.length === 0) return false;
  for (const tok of GENERIC_TITLE_TOKENS) {
    if (nt === tok) return true;
    if (nt.includes(tok) && nt.length <= tok.length + 14) return true;
  }
  return false;
}

// Length of the shared prefix between two strings (in chars).
function commonPrefixLen(a: string, b: string): number {
  const n = Math.min(a.length, b.length);
  let i = 0;
  while (i < n && a.charCodeAt(i) === b.charCodeAt(i)) i++;
  return i;
}

export type DupeEvent = {
  id: string;
  title: string;
  start_time: string;
  end_time: string | null;
  description_length: number;
  image_url: string | null;
  venue_id: string;
  venue_name: string | null;
  venue_slug: string | null;
  city_slug: string | null;
  festival_id: string | null;
  festival_name: string | null;
  auto_imported_from: string | null;
  auto_import_confidence: number | null;
  artist_count: number;
  organiser_count: number;
  created_at: string;
};

export type DupeEventGroup = {
  key: string; // venue_id + YYYY-MM-DD
  venueName: string;
  citySlug: string | null;
  day: string; // YYYY-MM-DD
  events: DupeEvent[];
};

export type FindEventDupesResult =
  | { error: string }
  | { ok: true; groups: DupeEventGroup[]; totalDupes: number };

export async function findEventDuplicates(
  scope: { festivalId?: string | null; days?: number },
): Promise<FindEventDupesResult> {
  const ctx = await requireAdmin();
  if (!ctx) return { error: "Admins only." };

  const sb = createServiceClient();
  const days = Math.max(1, Math.min(365, scope.days ?? 90));

  // Window: from yesterday-start (so today's morning events still appear) to +N days.
  const fromIso = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const toIso = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();

  let query = sb
    .from("events")
    .select(
      "id, title, start_time, end_time, description, image_url, venue_id, festival_id, auto_imported_from, auto_import_confidence, created_at, venue:venues(name, slug, city:cities(slug)), festival:festivals(name)",
    )
    .gte("start_time", fromIso)
    .lte("start_time", toIso)
    .neq("status", "rejected");
  if (scope.festivalId) {
    query = query.eq("festival_id", scope.festivalId);
  }
  const { data: rows, error } = await query;
  if (error) return { error: error.message };
  if (!rows || rows.length === 0) return { ok: true, groups: [], totalDupes: 0 };

  // Group by venue + calendar day (London-local, since festivals run on local days).
  const groups = new Map<string, any[]>();
  for (const r of rows) {
    const t = new Date(r.start_time as string);
    // YYYY-MM-DD in Europe/London — same convention used by the day planner.
    const day = t.toLocaleDateString("en-CA", { timeZone: "Europe/London" });
    const key = `${r.venue_id}|${day}`;
    const list = groups.get(key) ?? [];
    list.push(r);
    groups.set(key, list);
  }

  // Within each venue+day cluster, sub-cluster by title overlap so genuinely
  // different events (e.g. quiz at 7pm + band at 10pm) don't get flagged.
  const dupGroups: DupeEventGroup[] = [];
  for (const [key, list] of groups.entries()) {
    if (list.length < 2) continue;
    const subgroups = clusterByTitleOverlap(list);
    for (const sg of subgroups) {
      if (sg.length < 2) continue;

      // Collect artist + organiser counts in one batch per subgroup.
      const ids = sg.map((e: any) => e.id);
      const [artistRes, organiserRes] = await Promise.all([
        sb.from("event_artists").select("event_id").in("event_id", ids),
        sb.from("event_organisers").select("event_id").in("event_id", ids),
      ]);
      const artistCount = new Map<string, number>();
      for (const r of artistRes.data ?? []) {
        artistCount.set(r.event_id as string, (artistCount.get(r.event_id as string) ?? 0) + 1);
      }
      const organiserCount = new Map<string, number>();
      for (const r of organiserRes.data ?? []) {
        organiserCount.set(r.event_id as string, (organiserCount.get(r.event_id as string) ?? 0) + 1);
      }

      const day = key.split("|")[1];
      const first = sg[0];
      const venue = (first.venue ?? {}) as any;
      const decorated: DupeEvent[] = sg
        .map((e: any) => ({
          id: e.id,
          title: e.title,
          start_time: e.start_time,
          end_time: e.end_time ?? null,
          description_length: (e.description ?? "").length,
          image_url: e.image_url ?? null,
          venue_id: e.venue_id,
          venue_name: (e.venue as any)?.name ?? null,
          venue_slug: (e.venue as any)?.slug ?? null,
          city_slug: (e.venue as any)?.city?.slug ?? null,
          festival_id: e.festival_id ?? null,
          festival_name: (e.festival as any)?.name ?? null,
          auto_imported_from: e.auto_imported_from ?? null,
          auto_import_confidence: e.auto_import_confidence ?? null,
          artist_count: artistCount.get(e.id) ?? 0,
          organiser_count: organiserCount.get(e.id) ?? 0,
          created_at: e.created_at,
        }))
        // Auto-suggest winner first: prefers specific titles over "Live Music",
        // manual over auto-imports, then more linked artists, longer desc, image, older row.
        .sort((a, b) => {
          const ag = isGenericTitle(a.title) ? 1 : 0;
          const bg = isGenericTitle(b.title) ? 1 : 0;
          if (ag !== bg) return ag - bg;
          const am = !a.auto_imported_from ? 1 : 0;
          const bm = !b.auto_imported_from ? 1 : 0;
          if (am !== bm) return bm - am;
          if (a.artist_count !== b.artist_count) return b.artist_count - a.artist_count;
          if (a.description_length !== b.description_length)
            return b.description_length - a.description_length;
          const ai = a.image_url ? 1 : 0;
          const bi = b.image_url ? 1 : 0;
          if (ai !== bi) return bi - ai;
          return a.created_at.localeCompare(b.created_at);
        });
      dupGroups.push({
        key: `${key}|${normaliseTitle(decorated[0].title).slice(0, 12)}`,
        venueName: venue.name ?? "—",
        citySlug: venue.city?.slug ?? null,
        day,
        events: decorated,
      });
    }
  }

  // Sort groups by day ascending so soonest dupes appear first.
  dupGroups.sort((a, b) => a.day.localeCompare(b.day));

  return {
    ok: true,
    groups: dupGroups,
    totalDupes: dupGroups.reduce((s, g) => s + g.events.length - 1, 0),
  };
}

// Same clustering rule as the cron — keep both in lockstep.
function clusterByTitleOverlap<T extends { id: string; title: string }>(events: T[]): T[][] {
  const clusters: T[][] = [];
  for (const e of events) {
    const nk = dedupeKey(e.title);
    const eGeneric = isGenericTitle(e.title);
    let placed = false;
    for (const cluster of clusters) {
      const matches = cluster.some((c) => {
        const ck = dedupeKey(c.title);
        // 1. Stripped-and-normalised titles are equal — catches
        //    "LIVE SPORTS — 7 MATCHES" vs "LIVE SPORTS — 8 MATCHES"
        //    after the count suffix is stripped.
        if (ck === nk) return true;
        // 2. One contains the other and both have ≥6 chars.
        if (nk.length >= 6 && ck.length >= 6 && (nk.includes(ck) || ck.includes(nk))) return true;
        // 3. Generic ↔ specific cluster at same venue+day — the generic
        //    is the recurring placeholder for the specific event.
        const cGeneric = isGenericTitle(c.title);
        if (eGeneric !== cGeneric) return true;
        // 4. Both generic with a shared ≥6-char prefix — catches
        //    near-identical aggregation titles that share a stem but
        //    weren't fully collapsed by the suffix-strip (defensive).
        if (eGeneric && cGeneric && commonPrefixLen(nk, ck) >= 6) return true;
        return false;
      });
      if (matches) {
        cluster.push(e);
        placed = true;
        break;
      }
    }
    if (!placed) clusters.push([e]);
  }
  return clusters;
}

export type MergeEventsResult =
  | { error: string }
  | {
      ok: true;
      winnerId: string;
      moved: { artists: number; organisers: number; genres: number; favourites: number };
      filledFields: string[];
      losersDeleted: number;
    };

export async function mergeEvents(
  winnerId: string,
  loserIds: string[],
): Promise<MergeEventsResult> {
  const ctx = await requireAdmin();
  if (!ctx) return { error: "Admins only." };
  if (loserIds.length === 0) return { error: "No losers to merge." };
  if (loserIds.includes(winnerId)) return { error: "Winner can't also be a loser." };

  const sb = createServiceClient();

  // 1. Sanity-check that all ids exist.
  const allIds = [winnerId, ...loserIds];
  const { data: rows } = await sb
    .from("events")
    .select("id, title, start_time, image_url, description")
    .in("id", allIds);
  if (!rows || rows.length !== allIds.length) {
    return { error: "One or more event IDs not found." };
  }
  const winner = rows.find((e) => e.id === winnerId)!;
  const losers = rows.filter((e) => e.id !== winnerId);

  // 2. Move event_artists. Upsert with ignoreDuplicates handles the
  //    case where the winner already has the same artist linked.
  let artistsMoved = 0;
  const { data: artistLinks } = await sb
    .from("event_artists")
    .select("artist_id, event_id")
    .in("event_id", loserIds);
  if (artistLinks && artistLinks.length > 0) {
    const upserts = artistLinks.map((l) => ({
      event_id: winnerId,
      artist_id: l.artist_id,
    }));
    const { error } = await sb
      .from("event_artists")
      .upsert(upserts, { onConflict: "event_id,artist_id", ignoreDuplicates: true });
    if (!error) artistsMoved = upserts.length;
  }

  // 3. Move event_organisers.
  let organisersMoved = 0;
  const { data: orgLinks } = await sb
    .from("event_organisers")
    .select("organiser_id, event_id")
    .in("event_id", loserIds);
  if (orgLinks && orgLinks.length > 0) {
    const upserts = orgLinks.map((l) => ({
      event_id: winnerId,
      organiser_id: l.organiser_id,
    }));
    const { error } = await sb
      .from("event_organisers")
      .upsert(upserts, { onConflict: "event_id,organiser_id", ignoreDuplicates: true });
    if (!error) organisersMoved = upserts.length;
  }

  // 4. Move event_genres.
  let genresMoved = 0;
  const { data: genreLinks } = await sb
    .from("event_genres")
    .select("genre_id, event_id")
    .in("event_id", loserIds);
  if (genreLinks && genreLinks.length > 0) {
    const upserts = genreLinks.map((l) => ({
      event_id: winnerId,
      genre_id: l.genre_id,
    }));
    const { error } = await sb
      .from("event_genres")
      .upsert(upserts, { onConflict: "event_id,genre_id", ignoreDuplicates: true });
    if (!error) genresMoved = upserts.length;
  }

  // 5. Re-point favourites pointing at the loser as target_id.
  //    favourites is polymorphic (no FK) so this is a manual update.
  //    If the same user has already favourited the winner, the unique
  //    constraint will reject — in that case just delete the loser row.
  let favouritesMoved = 0;
  const { data: favs } = await sb
    .from("favourites")
    .select("id, user_id")
    .eq("target_type", "event")
    .in("target_id", loserIds);
  for (const f of favs ?? []) {
    const { error: upErr } = await sb
      .from("favourites")
      .update({ target_id: winnerId })
      .eq("id", f.id);
    if (upErr) {
      // Probably a unique-constraint hit — winner already favourited by this user.
      await sb.from("favourites").delete().eq("id", f.id);
    } else {
      favouritesMoved++;
    }
  }

  // 6. Fill blank fields on the winner from the losers (image_url, description).
  const filledFields: string[] = [];
  const updates: Record<string, string> = {};
  if (!winner.image_url) {
    const withImg = losers.find((l) => l.image_url);
    if (withImg?.image_url) {
      updates.image_url = withImg.image_url;
      filledFields.push("image_url");
    }
  }
  if (!winner.description || winner.description.length < 20) {
    const withDesc = losers
      .filter((l) => l.description && l.description.length >= 20)
      .sort((a, b) => (b.description?.length ?? 0) - (a.description?.length ?? 0))[0];
    if (withDesc?.description) {
      updates.description = withDesc.description;
      filledFields.push("description");
    }
  }
  if (Object.keys(updates).length > 0) {
    await sb.from("events").update(updates).eq("id", winnerId);
  }

  // 7. Delete the losers. notifications_sent + page_views cascade-delete
  //    via FK; event_artists/genres/organisers rows for the loser also
  //    cascade. favourites we already handled in step 5.
  const { count: losersDeleted } = await sb
    .from("events")
    .delete({ count: "exact" })
    .in("id", loserIds);

  revalidatePath("/admin/events-dedupe");
  revalidatePath("/admin/cron-runs");

  return {
    ok: true,
    winnerId,
    moved: {
      artists: artistsMoved,
      organisers: organisersMoved,
      genres: genresMoved,
      favourites: favouritesMoved,
    },
    filledFields,
    losersDeleted: losersDeleted ?? 0,
  };
}
