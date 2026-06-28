// Per-venue scrape → extract → dedupe → insert pipeline.
//
// Extracted from src/app/api/cron/scrape-facebook/route.ts so both the
// scheduled cron AND the admin "pull events from this venue now" button
// run identical logic. Any behaviour change here automatically affects
// both call sites — no drift.
//
// The function does NOT update venues.last_facebook_scrape itself; the
// caller decides whether to bump it (cron yes; some manual flows no).
// Posters, genres, and artists are linked best-effort after the events
// are inserted.
//
// Returns counts so the caller can log / show a summary to the user.
// Errors are returned in the `error` field rather than thrown, because
// the cron processes a batch of venues and one failure shouldn't kill
// the rest.
//
// SAFETY: this function is intentionally pure-ish — it reads from
// Supabase via the supplied client and writes events / event_genres /
// event_artists. It does NOT touch venues, fb_scrape_venue_runs, or any
// other table. The caller owns those.

import type { SupabaseClient } from "@supabase/supabase-js";
import { scrapeVenueFacebook } from "@/lib/scrape-facebook";
import { extractEvents, type ExtractedEvent } from "@/lib/extraction";
import { uploadPosterFromUrl } from "@/lib/poster-storage";

// How many future occurrences to generate when the AI says a gig is
// weekly. 8 weeks = ~2 months, enough that residencies / quiz nights
// always show on the homepage's "next 30 days" view. Each subsequent
// scrape will see the same recurring post and the dedupe step keeps us
// from duplicating rows.
const RECURRING_WEEKS_AHEAD = 8;

/**
 * Expand an AI-extracted event into all its concrete occurrences. For
 * one-off events this is just the event itself. For weekly recurring
 * events ("Open Mic every Friday", "Quiz Tuesdays") we generate the
 * next N occurrences so the public page actually shows future dates,
 * not just one row from whenever the post was made.
 *
 * Monthly / sporadic patterns are returned as a single occurrence —
 * too risky to invent dates the AI didn't anchor.
 */
export function expandRecurring(
  e: ExtractedEvent,
): Array<{ starts_at: string; ends_at: string | null }> {
  const result: Array<{ starts_at: string; ends_at: string | null }> = [
    { starts_at: e.starts_at, ends_at: e.ends_at },
  ];
  const r = e.recurring;
  if (!r || !r.pattern) return result;
  const p = r.pattern.toLowerCase().trim();
  const weekly =
    p === "weekly" ||
    p === "every_week" ||
    /^every_(monday|tuesday|wednesday|thursday|friday|saturday|sunday)$/.test(p);
  if (!weekly) return result;

  const start = new Date(e.starts_at);
  if (Number.isNaN(start.getTime())) return result;
  const end = e.ends_at ? new Date(e.ends_at) : null;
  // `until` may be a date-only string (YYYY-MM-DD) per the AI's contract —
  // anchor to end-of-day UTC so a "until 2026-06-15" gig still includes
  // an event on the 15th itself.
  const untilDate = r.until ? new Date(`${r.until}T23:59:59Z`) : null;
  const untilValid = untilDate && !Number.isNaN(untilDate.getTime()) ? untilDate : null;

  for (let w = 1; w <= RECURRING_WEEKS_AHEAD; w++) {
    const nextStart = new Date(start);
    nextStart.setDate(nextStart.getDate() + 7 * w);
    if (untilValid && nextStart > untilValid) break;
    const nextEnd = end ? new Date(end) : null;
    if (nextEnd) nextEnd.setDate(nextEnd.getDate() + 7 * w);
    result.push({
      starts_at: nextStart.toISOString(),
      ends_at: nextEnd ? nextEnd.toISOString() : null,
    });
  }
  return result;
}

export type VenueForIngest = {
  id: string;
  name: string;
  facebook: string;
  city_id: string | null;
};

export type IngestOptions = {
  venue: VenueForIngest;
  apifyToken: string;
  maxPosts: number;
  availableGenres: Array<{ slug: string; name: string }>;
  genreSlugToId: Map<string, string>;
  // When true, don't write to Supabase — just count what would happen.
  // Used by the cron's ?dry=1 admin override.
  dry?: boolean;
  // Service-role Supabase client. Caller supplies it so we don't have to
  // pick between server / service auth — this function ingests events
  // unconditionally (bypassing RLS), so it must be the service client.
  supabase: SupabaseClient<any, "public", any>;
  // Optional: backfill venues.cover_photo_url from Apify's page meta if
  // the venue doesn't have one yet. Cron passes true; admin one-off
  // button can opt out if it wants minimum side effects.
  backfillCoverPhoto?: boolean;
};

export type IngestResult = {
  posts: number;
  events: number;
  skipped: number;
  error?: string;
};

/**
 * Scrape one venue's Facebook page and ingest any new events.
 *
 * Pipeline:
 *   1. Apify FB scraper → raw posts + page meta
 *   2. (optional) Backfill venue cover_photo_url from page meta
 *   3. For each post:
 *      - extractEvents (AI) → events
 *      - Validate (drop missing-title / invalid-date rows)
 *      - Dedupe against existing events at same venue + ±1 hour
 *      - Expand recurring patterns
 *      - Insert into events table (auto-approved)
 *      - Upload poster to Supabase Storage
 *      - Link genres + artists (find-or-create artists)
 */
export async function scrapeAndIngestVenue(opts: IngestOptions): Promise<IngestResult> {
  const {
    venue: v,
    apifyToken,
    maxPosts,
    availableGenres,
    genreSlugToId,
    dry,
    supabase: sb,
    backfillCoverPhoto = true,
  } = opts;

  let posts = 0;
  let events = 0;
  let skipped = 0;
  let err: string | undefined;

  try {
    const scrape = await scrapeVenueFacebook({
      facebookUrl: v.facebook,
      apifyToken,
      maxPosts,
    });
    posts = scrape.posts.length;

    // Cover photo backfill: if this venue has no cover_photo_url yet and
    // Apify returned a page profile picture, persist it. We prefer the
    // cover photo over the profile pic when both exist (cover is wider
    // and usually shows the venue exterior); fall back to profile pic.
    // Best-effort: failures here don't break the gig extraction.
    if (backfillCoverPhoto) {
      try {
        const candidate = scrape.pageMeta.coverPictureUrl ?? scrape.pageMeta.profilePictureUrl;
        if (candidate && !dry) {
          const { data: vRow } = await sb
            .from("venues")
            .select("cover_photo_url")
            .eq("id", v.id)
            .maybeSingle();
          if (!vRow?.cover_photo_url) {
            await sb.from("venues").update({
              cover_photo_url: candidate,
              cover_photo_last_attempt: new Date().toISOString(),
            }).eq("id", v.id);
          }
        }
      } catch { /* swallow — cover photo is opportunistic */ }
    }

    for (const post of scrape.posts) {
      try {
        const extraction = await extractEvents({
          venueName: v.name,
          postedAt: post.postedAt,
          textContent: post.text || null,
          imageUrls: post.imageUrls,
          availableGenres,
        });
        if (extraction.events.length === 0) continue;

        // Drop any AI-returned event that's missing required fields. The
        // events.start_time column is NOT NULL, so a null starts_at would
        // crash the whole batch insert.
        extraction.events = extraction.events.filter((e) => {
          if (!e.title || !e.title.trim()) return false;
          if (!e.starts_at) return false;
          const t = new Date(e.starts_at);
          if (Number.isNaN(t.getTime())) return false;
          return true;
        });
        if (extraction.events.length === 0) continue;

        // Dedupe against existing events at this venue
        const { data: existing } = await sb
          .from("events")
          .select("title, start_time")
          .eq("venue_id", v.id)
          .neq("status", "rejected");
        const seen = new Set<string>();
        const titlesByHour = new Map<string, string[]>();
        const norm = (t: string) => (t || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
        const hourKey = (iso: string) => {
          const t = new Date(iso);
          if (Number.isNaN(t.getTime())) return iso;
          const pad = (n: number) => String(n).padStart(2, "0");
          return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}T${pad(t.getUTCHours())}`;
        };
        for (const e of existing ?? []) {
          const hk = hourKey(e.start_time);
          const nt = norm(e.title);
          seen.add(`${nt}|${hk}`);
          const list = titlesByHour.get(hk) ?? [];
          list.push(nt);
          titlesByHour.set(hk, list);
        }

        // Dedupe + recurring expansion. Each AI event is expanded into
        // one or more concrete occurrences (one for one-offs, N for
        // weekly residencies). Each occurrence runs its own dedupe
        // check, so an existing event row for "next Friday's Open Mic"
        // doesn't get duplicated when this scrape finds the same
        // recurring post.
        const drafts: ExtractedEvent[] = [];
        const rows: Array<Record<string, unknown>> = [];
        for (const e of extraction.events) {
          const occurrences = expandRecurring(e);
          for (const occ of occurrences) {
            const hk = hourKey(occ.starts_at);
            const nt = norm(e.title);
            if (seen.has(`${nt}|${hk}`)) { skipped++; continue; }
            const sameHour = titlesByHour.get(hk) ?? [];
            const overlap = sameHour.find((t) =>
              nt.length >= 6 && t.length >= 6 && (t.includes(nt) || nt.includes(t))
            );
            if (overlap) { skipped++; continue; }
            seen.add(`${nt}|${hk}`);
            sameHour.push(nt);
            titlesByHour.set(hk, sameHour);

            const idx = e.poster_image_index;
            const posterSrc =
              typeof idx === "number" && idx >= 0 && idx < post.imageUrls.length
                ? post.imageUrls[idx]
                : post.imageUrls[0] ?? null;
            rows.push({
              venue_id: v.id,
              title: e.title.slice(0, 200),
              start_time: occ.starts_at,
              end_time: occ.ends_at,
              description: (e.description ?? "").slice(0, 2000),
              status: "approved",
              auto_imported_from: "facebook",
              auto_import_confidence: e.confidence,
              auto_import_source_url: post.url || v.facebook,
              auto_import_image_url: posterSrc,
              auto_import_post_text: post.text || null,
              image_url: posterSrc,
            });
            drafts.push(e);
          }
        }
        if (rows.length === 0 || dry) {
          events += rows.length;
          continue;
        }

        const { data: created, error: insErr } = await sb.from("events").insert(rows).select("id");
        if (insErr) { err = `Insert: ${insErr.message}`; continue; }
        if (!created) continue;
        events += created.length;

        // Persist posters + link genres + artists (best-effort, async).
        // drafts[i] is the AI event that produced rows[i]; multiple
        // rows can share a draft when recurring expansion fired.
        for (let i = 0; i < created.length; i++) {
          const eventId = created[i].id;
          const draft = drafts[i];
          // rows[] is loosely typed (Record<string, unknown>) because each
          // row is a mixed-shape DB insert payload — narrow the poster
          // URL back to string at the use site.
          const posterSrc = rows[i].auto_import_image_url as string | null;
          if (posterSrc) {
            const stored = await uploadPosterFromUrl(sb, { sourceUrl: posterSrc, eventId });
            if ("ok" in stored) {
              await sb.from("events")
                .update({ image_url: stored.publicUrl, auto_import_image_url: stored.publicUrl })
                .eq("id", eventId);
            }
          }
          // Genres
          const gLinks = (draft.genres ?? [])
            .map((s) => genreSlugToId.get(s))
            .filter((id): id is string => !!id)
            .map((gid) => ({ event_id: eventId, genre_id: gid }));
          if (gLinks.length > 0) await sb.from("event_genres").insert(gLinks);
          // Artists (find or create)
          const names = (draft.artists ?? []).map((s) => s.trim()).filter((s) => s.length > 0 && s.length <= 80);
          for (const name of names) {
            const { data: existing } = await sb
              .from("artists")
              .select("id")
              .ilike("name", name)
              .maybeSingle();
            let aid: string | null = existing?.id ?? null;
            if (!aid) {
              const slugBase = name.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9\s-]/g, "")
                .replace(/\s+/g, "-").replace(/-+/g, "-").replace(/^-+|-+$/g, "").slice(0, 100) || "artist";
              let s = slugBase;
              for (let j = 0; j < 5; j++) {
                const { data: nu, error: aErr } = await sb
                  .from("artists")
                  .insert({ name, slug: s, city_id: v.city_id, approved: true })
                  .select("id")
                  .single();
                if (!aErr && nu) { aid = nu.id; break; }
                if (aErr?.code === "23505") { s = `${slugBase}-${j + 2}`; continue; }
                break;
              }
            }
            if (aid) {
              await sb.from("event_artists")
                .upsert([{ event_id: eventId, artist_id: aid }], { onConflict: "event_id,artist_id", ignoreDuplicates: true });
            }
          }
        }
      } catch (postErr: any) {
        err = (err ? err + "; " : "") + `Post extract: ${postErr?.message ?? postErr}`;
      }
    }
  } catch (e: any) {
    err = `FB scrape: ${e?.message ?? e}`;
  }

  return { posts, events, skipped, ...(err ? { error: err } : {}) };
}
