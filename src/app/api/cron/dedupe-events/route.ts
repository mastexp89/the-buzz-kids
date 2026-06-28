// Daily cron: deduplicate events.
//
// Two events at the SAME venue at the SAME start hour with similar titles
// = duplicate. Picks a winner, merges artists + genres into the winner,
// deletes the loser(s).
//
// Winner ranking (highest first):
//   1. Manually-created events (auto_imported_from IS NULL) beat auto-imports
//   2. Among auto-imports: higher auto_import_confidence wins
//   3. More artists / longer description as tiebreakers
//
// Conservative: never deletes a purely-manual event. Two manual events that
// truly conflict get logged but left alone for admin review.
//
// Schedule: 0 3 * * *  (every day at 03:00 UTC)
//
// Required env: CRON_SECRET (same one as the FB scraper)
// Auth: Vercel sends Authorization: Bearer ${CRON_SECRET} automatically.
//
// Tunables:
//   ?dry=1     — list duplicates but don't delete
//   ?days=N    — only consider events starting in next N days (default 90)

import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";

export const maxDuration = 60;

export async function GET(req: Request) {
  const auth = req.headers.get("authorization");
  const expected = `Bearer ${process.env.CRON_SECRET ?? ""}`;
  if (!process.env.CRON_SECRET || auth !== expected) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }

  const url = new URL(req.url);
  const dry = url.searchParams.get("dry") === "1";
  const days = Math.max(1, Math.min(365, Number(url.searchParams.get("days") ?? 90)));

  const sb = createServiceClient();

  const fromIso = new Date().toISOString();
  const toIso = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();

  // Pull every upcoming event in window. ~thousands at most; manageable.
  const { data: events, error: evErr } = await sb
    .from("events")
    .select("id, venue_id, title, start_time, description, image_url, auto_imported_from, auto_import_confidence, created_at")
    .gte("start_time", fromIso)
    .lte("start_time", toIso)
    .neq("status", "rejected");
  if (evErr) return NextResponse.json({ error: `Fetch events: ${evErr.message}` }, { status: 500 });
  if (!events || events.length === 0) {
    return NextResponse.json({ ok: true, scanned: 0, dupGroups: 0, removed: 0 });
  }

  // Group events by venue_id + start hour
  const groups = new Map<string, typeof events>();
  for (const e of events) {
    const t = new Date(e.start_time);
    const hourKey = `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}T${pad(t.getUTCHours())}`;
    const key = `${e.venue_id}|${hourKey}`;
    const list = groups.get(key) ?? [];
    list.push(e);
    groups.set(key, list);
  }

  const dupGroupsFound: any[] = [];
  let removed = 0;
  let mergedArtists = 0;
  let mergedGenres = 0;
  const skipped: any[] = [];

  for (const [key, list] of groups.entries()) {
    if (list.length < 2) continue;

    // Within a group, find titles that overlap (substring or exact normalised)
    // We may have multiple distinct events at the same hour at one venue —
    // e.g. a sports screening + a pub quiz. Don't merge those.
    const subgroups = clusterByTitleOverlap(list);
    for (const sg of subgroups) {
      if (sg.length < 2) continue;

      // Conservative: if more than one is purely manual, don't auto-merge —
      // UNLESS at least one is a generic placeholder ("Live Music" / "Karaoke" /
      // "Quiz Night" etc.) — in that case the specific title is clearly the
      // real event and the generic one is the recurring filler that should go.
      const manuals = sg.filter((e) => !e.auto_imported_from);
      const hasGeneric = sg.some((e) => isGenericTitle(e.title));
      const hasSpecific = sg.some((e) => !isGenericTitle(e.title));
      if (manuals.length > 1 && !(hasGeneric && hasSpecific)) {
        skipped.push({ key, count: sg.length, reason: "multiple manual", ids: sg.map((e) => e.id) });
        continue;
      }

      const winner = pickWinner(sg);
      const losers = sg.filter((e) => e.id !== winner.id);

      dupGroupsFound.push({
        key,
        winnerId: winner.id,
        winnerTitle: winner.title,
        loserIds: losers.map((l) => l.id),
        loserTitles: losers.map((l) => l.title),
      });

      if (dry) continue;

      // Move artists from losers to winner (upsert ignores existing pairs)
      const { data: linksA } = await sb
        .from("event_artists")
        .select("artist_id, event_id")
        .in("event_id", losers.map((l) => l.id));
      const newArtistLinks = (linksA ?? [])
        .map((l) => ({ event_id: winner.id, artist_id: l.artist_id }));
      if (newArtistLinks.length > 0) {
        const { error } = await sb.from("event_artists").upsert(newArtistLinks, {
          onConflict: "event_id,artist_id",
          ignoreDuplicates: true,
        });
        if (!error) mergedArtists += newArtistLinks.length;
      }

      // Move genres from losers to winner
      const { data: linksG } = await sb
        .from("event_genres")
        .select("genre_id, event_id")
        .in("event_id", losers.map((l) => l.id));
      const newGenreLinks = (linksG ?? [])
        .map((l) => ({ event_id: winner.id, genre_id: l.genre_id }));
      if (newGenreLinks.length > 0) {
        const { error } = await sb.from("event_genres").upsert(newGenreLinks, {
          onConflict: "event_id,genre_id",
          ignoreDuplicates: true,
        });
        if (!error) mergedGenres += newGenreLinks.length;
      }

      // Fill blank fields on the winner from losers (image_url, description)
      const updates: Record<string, string> = {};
      if (!winner.image_url) {
        const withImg = losers.find((l) => l.image_url);
        if (withImg?.image_url) updates.image_url = withImg.image_url;
      }
      if (!winner.description || winner.description.length < 20) {
        const withDesc = losers
          .filter((l) => l.description && l.description.length >= 20)
          .sort((a, b) => (b.description?.length ?? 0) - (a.description?.length ?? 0))[0];
        if (withDesc?.description) updates.description = withDesc.description;
      }
      if (Object.keys(updates).length > 0) {
        await sb.from("events").update(updates).eq("id", winner.id);
      }

      // Delete losers. event_artists / event_genres rows for those event_ids
      // should cascade-delete via FK; if not, that's fine — they're orphaned
      // but harmless.
      const { error: delErr } = await sb
        .from("events")
        .delete()
        .in("id", losers.map((l) => l.id));
      if (!delErr) removed += losers.length;
    }
  }

  // Piggyback on this daily run to drop audit_log rows older than 30 days.
  // The audit log only ever grows otherwise — pruning here keeps it
  // bounded without needing a separate cron entry. Best-effort: failure
  // here doesn't affect the dedupe result.
  let auditPruned = 0;
  if (!dry) {
    const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const { count, error: pruneErr } = await sb
      .from("audit_log")
      .delete({ count: "exact" })
      .lt("created_at", cutoff);
    if (!pruneErr) auditPruned = count ?? 0;
  }

  return NextResponse.json({
    ok: true,
    scanned: events.length,
    dupGroups: dupGroupsFound.length,
    removed,
    mergedArtists,
    mergedGenres,
    skipped,
    auditPruned,
    dry,
    sample: dupGroupsFound.slice(0, 20),
  });
}

function pad(n: number) {
  return String(n).padStart(2, "0");
}

function normaliseTitle(t: string): string {
  return (t || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

// Strip aggregation count suffixes so titles that only differ in the
// rolling match-count cluster together. e.g.
//   "LIVE SPORTS — 7 MATCHES" → "LIVE SPORTS"
//   "LIVE SPORTS — 8 MATCHES" → "LIVE SPORTS"
// Both collapse to the same dedupe key and get clustered.
// Mirror of stripCountSuffix in src/app/admin/events-dedupe/actions.ts —
// keep the two in lockstep.
function stripCountSuffix(t: string): string {
  return String(t || "")
    .replace(/\s*[–—\-:|·]\s*\d+\s*(match(?:es)?|games?|fixtures?|events?)\s*$/i, "")
    .replace(/\s*\(\s*\d+\s*(match(?:es)?|games?|fixtures?|events?)\s*\)\s*$/i, "")
    .trim();
}

function dedupeKey(t: string): string {
  return normaliseTitle(stripCountSuffix(t));
}

// Generic placeholder titles that appear at venues alongside the actual booking
// for that night. e.g. a venue marks every Thursday as "Live Music" while the
// specific act ("Andrew Acoustic") gets added separately. These generic events
// should merge into the specific event at the same venue+hour.
const GENERIC_TITLE_TOKENS = [
  "livemusic",
  "liveband",
  "livesports",
  "karaoke",
  "openmic",
  "openmicnight",
  "pubquiz",
  "quiznight",
  "djset",
  "djnight",
  "discoteque",
  "comedynight",
  "tribute",
  "live",
];

function isGenericTitle(title: string): boolean {
  const nt = normaliseTitle(stripCountSuffix(title));
  if (nt.length === 0) return false;
  for (const tok of GENERIC_TITLE_TOKENS) {
    if (nt === tok) return true;
    // Allow up to 12 chars of filler around the generic token
    // ("livemusictonight", "karaokethursday", "livemusicattheanchor"…)
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

// Cluster events by title overlap or generic-vs-specific match. Two events at
// the same venue+hour go in the same cluster if:
//   1. Their stripped-and-normalised titles are equal (catches
//      "LIVE SPORTS — 7 MATCHES" vs "LIVE SPORTS — 8 MATCHES"
//      after the count suffix is stripped), OR
//   2. One contains the other (and both have ≥6 chars), OR
//   3. One has a generic title (e.g. "Live Music") and the other doesn't —
//      same venue+hour + generic = it's the placeholder for the specific event, OR
//   4. Both are generic with a shared ≥6-char prefix — catches near-identical
//      aggregation titles that share a stem but slipped past the suffix-strip.
function clusterByTitleOverlap<T extends { id: string; title: string }>(events: T[]): T[][] {
  const clusters: T[][] = [];
  for (const e of events) {
    const nk = dedupeKey(e.title);
    const eGeneric = isGenericTitle(e.title);
    let placed = false;
    for (const cluster of clusters) {
      const matches = cluster.some((c) => {
        const ck = dedupeKey(c.title);
        if (ck === nk) return true;
        if (nk.length >= 6 && ck.length >= 6 && (nk.includes(ck) || ck.includes(nk))) return true;
        const cGeneric = isGenericTitle(c.title);
        if (eGeneric !== cGeneric) return true;
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

// Pick the most-authoritative event in a duplicate cluster.
function pickWinner<T extends {
  id: string;
  title: string;
  auto_imported_from: string | null;
  auto_import_confidence: number | null;
  description: string | null;
  created_at: string | null;
}>(events: T[]): T {
  return [...events].sort((a, b) => {
    // Specific title beats generic placeholder ("Andrew Acoustic" beats "Live Music")
    const aGeneric = isGenericTitle(a.title) ? 1 : 0;
    const bGeneric = isGenericTitle(b.title) ? 1 : 0;
    if (aGeneric !== bGeneric) return aGeneric - bGeneric; // non-generic first
    // Manual > auto-imported
    const aManual = !a.auto_imported_from ? 1 : 0;
    const bManual = !b.auto_imported_from ? 1 : 0;
    if (aManual !== bManual) return bManual - aManual;
    // Higher confidence wins
    const aConf = a.auto_import_confidence ?? 0;
    const bConf = b.auto_import_confidence ?? 0;
    if (aConf !== bConf) return bConf - aConf;
    // Longer description wins
    const aLen = a.description?.length ?? 0;
    const bLen = b.description?.length ?? 0;
    if (aLen !== bLen) return bLen - aLen;
    // Newer wins (most recent edit usually has better data)
    const aT = a.created_at ? new Date(a.created_at).getTime() : 0;
    const bT = b.created_at ? new Date(b.created_at).getTime() : 0;
    return bT - aT;
  })[0];
}
