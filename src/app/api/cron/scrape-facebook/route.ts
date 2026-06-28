// Vercel Cron entry point: scrapes the N stalest FB-enabled venues and runs
// AI event extraction across recent posts.
//
// Schedule: every 5 minutes between 21:00–23:55 UTC on Mon + Thu
// (configured in vercel.json). Each tick picks the next batch of stalest
// venues — the natural ordering by last_facebook_scrape (NULLS FIRST)
// means consecutive ticks pick up where the previous one left off without
// any cursor or offset, even if the self-chain (below) dies mid-sweep.
// 36 ticks × DEFAULT_BATCH (10) = 360 base venues per cron day, plus any
// extras the chain manages to complete.
//
// Auth:
//   - Vercel sends `Authorization: Bearer ${CRON_SECRET}` automatically when
//     CRON_SECRET is set in env. We verify it here.
//
// Required env vars:
//   - CRON_SECRET   — random string, set in Vercel + locally
//   - APIFY_TOKEN   — Apify API token used to call the FB scraper actor
//
// Tunables (query params):
//   - ?batch=N       limit how many venues to scrape this run (default 10)
//   - ?force=1       bypass the 12h re-scrape cooldown (admin override)
//   - ?maxPosts=N    posts per venue (default 3)
//   - ?dry=1         skip writes; just log what would happen

import { NextResponse, after } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { scrapeAndIngestVenue } from "@/lib/scrape-facebook-ingest";

// The per-venue ingest pipeline (Apify scrape → AI extract → dedupe →
// insert) lives in src/lib/scrape-facebook-ingest.ts so the admin's
// "Pull events for this venue" button and this cron run identical code.
// Changes there flow through to both without drift.

// Vercel Pro allows up to 300s — plenty of headroom for a batch of 6
// running through the 2-concurrent Apify pool (~3 sequential pairs ≈ 90s
// base, more if Apify is slow).
export const maxDuration = 300;

// With every-5-min cron ticks doing the real work, each tick can chew
// through more venues per invocation. 10 venues × ~30s per pair (2 at a
// time) ≈ 150s base — fits comfortably inside the 300s function ceiling
// even when Apify is sluggish. 36 ticks per cron day × 10 = 360 venues
// of capacity, enough for ~300 FB-enabled venues with headroom.
const DEFAULT_BATCH = 10;
// Was 3 — too few. Many venues' latest 3 posts are food specials /
// regulars photos / event recaps, and the actual upcoming-gig poster is
// further back. 5 doubles our chance of catching it without significantly
// raising Apify cost (~$1/sweep extra).
const DEFAULT_MAX_POSTS = 5;
// Apify free tier: 8GB total memory, FB scraper uses 4GB → max 2 concurrent.
// Bump this once you upgrade Apify (paid tier = 32GB = 8 concurrent).
//
// IMPORTANT: this also controls how many Anthropic extractEvents calls
// fly in parallel, which matters more for cost. Anthropic's low-tier
// org rate limit is 30,000 input tokens/min. Each post with text + a
// few images is ~5k tokens; 2 concurrent venues × 5 posts/venue = 10
// concurrent requests = ~50k tokens/min — over the limit.
// 1 concurrency = at most 5 in-flight requests = ~25k tokens/min, safely
// under the limit. extractEvents has a retry-with-backoff for the rare
// burst that still 429s. Bump this once you upgrade Anthropic's tier.
const APIFY_CONCURRENCY = 1;
// Skip venues that have already been scraped in the last N hours. Stops
// the late ticks of a cron sweep from re-scraping the venues that ran in
// the first ticks of the same sweep (they'd otherwise be the "stalest"
// rows again once everything else has caught up). Picked to comfortably
// span a single 3-hour cron window without blocking the next cron day.
const RESCRAPE_COOLDOWN_HOURS = 12;

// Venues that haven't produced an event in DORMANT_AFTER_DAYS get scraped
// on a much longer cooldown (DORMANT_COOLDOWN_DAYS). This cuts the
// majority of Apify spend without losing coverage — dormant venues are
// usually pubs that don't actually do gigs, or FB pages that have gone
// silent. A pub that suddenly posts next month's gig list will trip the
// 14-day cooldown and be scraped that day; the lag is acceptable for
// venues that have been quiet for 3+ months.
const DORMANT_AFTER_DAYS = 90;
const DORMANT_COOLDOWN_DAYS = 14;

// Claimed venues that have had ANY event added (manually by the owner,
// via the submit-gig flow, or by a previous scrape) within this window
// get skipped entirely by the cron. We trust the owner to maintain their
// own listings; scraping on top of that just creates near-duplicates the
// fuzzy dedupe can't always catch.
//
// If the venue goes quiet for OWNER_GRACE_DAYS+1, the cron resumes
// scraping as a safety net so the venue's public page doesn't go stale.
// Admin can see who's slacking via /admin/claimed-venues.
const OWNER_GRACE_DAYS = 30;

export async function GET(req: Request) {
  // Auth check: only allow Vercel cron + a manual override with the same secret.
  const auth = req.headers.get("authorization");
  const expected = `Bearer ${process.env.CRON_SECRET ?? ""}`;
  if (!process.env.CRON_SECRET || auth !== expected) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }

  const url = new URL(req.url);
  const batch = Math.max(1, Math.min(50, Number(url.searchParams.get("batch") ?? DEFAULT_BATCH)));
  const maxPosts = Math.max(1, Math.min(20, Number(url.searchParams.get("maxPosts") ?? DEFAULT_MAX_POSTS)));
  const dry = url.searchParams.get("dry") === "1";
  // Self-chaining: each invocation processes one batch; if more venues remain
  // it fires a follow-up call before returning. Used to scrape all 165+ venues
  // per cron day without hitting Vercel's per-function timeout.
  //
  // The chain used to use offset-based pagination but that silently skipped
  // venues: each batch updates the venues' `last_facebook_scrape` to NOW,
  // which reshuffles the `ORDER BY last_facebook_scrape ASC` set every time.
  // The offset would then jump past whoever just moved into the now-stalest
  // position, leaving them un-scraped until the next manual trigger.
  //
  // New approach: every chain link queries with `last_facebook_scrape <
  // runStart` (where runStart is fixed across the chain via query param).
  // Venues processed in this run have last_facebook_scrape >= runStart and
  // are excluded — so each batch picks up where the previous left off without
  // an explicit offset. The chain terminates naturally when the query
  // returns < batch venues (i.e. there are no more eligible).
  const runStartParam = url.searchParams.get("runStart");
  const runStartIso = runStartParam || new Date().toISOString();
  const chain = url.searchParams.get("chain") !== "0";
  // Optional city filter: ?city=dundee or ?city=angus restricts the scrape
  // to that city's venues only. Useful when you've just bulk-added a region
  // and want to populate JUST those without re-scraping everywhere.
  const cityFilterSlug = url.searchParams.get("city");

  const apifyToken = process.env.APIFY_TOKEN;
  if (!apifyToken) {
    return NextResponse.json({ error: "APIFY_TOKEN env var missing" }, { status: 500 });
  }

  const sb = createServiceClient();

  // Resolve the city slug (if any) to a city_id we can filter on.
  let cityIdFilter: string | null = null;
  if (cityFilterSlug) {
    const { data: cityRow } = await sb
      .from("cities")
      .select("id")
      .eq("slug", cityFilterSlug)
      .maybeSingle();
    if (!cityRow) {
      return NextResponse.json(
        { error: `Unknown city slug "${cityFilterSlug}"` },
        { status: 400 },
      );
    }
    cityIdFilter = cityRow.id;
  }

  // Exclude venues we've already scraped in the cooldown window. This
  // matters because Vercel cron fires this endpoint every 5 minutes — the
  // 30th tick of a sweep would otherwise re-pick the venues from tick 1
  // (now the "stalest" since everything else has been touched) and burn
  // Apify credit re-doing work. Manual sweeps from the admin UI can
  // bypass with ?force=1.
  //
  // Two tiers of cooldown:
  //   • Active venue   (had an event imported in last DORMANT_AFTER_DAYS) →
  //     12h cooldown (same as before).
  //   • Dormant venue  (no event imported in DORMANT_AFTER_DAYS, OR never had
  //     an event, OR last_event_imported_at is NULL on a fresh deploy) →
  //     14-day cooldown. Cuts Apify cost ~96% on these without losing
  //     coverage of venues that actually produce content.
  //
  // Expressed as a PostgREST OR-of-AND clause that PostgREST translates to
  // one SQL WHERE: `(active AND cooldown12h) OR (dormant AND cooldown14d) OR
  // last_facebook_scrape IS NULL`. The NULL branch ensures fresh venues
  // always get scraped at least once before the dormancy logic kicks in.
  const force = url.searchParams.get("force") === "1";
  const cooldown12hIso = new Date(
    Date.now() - RESCRAPE_COOLDOWN_HOURS * 60 * 60 * 1000,
  ).toISOString();
  const cooldown14dIso = new Date(
    Date.now() - DORMANT_COOLDOWN_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();
  const dormantCutoffIso = new Date(
    Date.now() - DORMANT_AFTER_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();
  const ownerGraceCutoffIso = new Date(
    Date.now() - OWNER_GRACE_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();
  const tieredCooldownClause = [
    // Never scraped → always eligible
    `last_facebook_scrape.is.null`,
    // Active venue, past 12h → eligible
    `and(last_event_imported_at.gte.${dormantCutoffIso},last_facebook_scrape.lt.${cooldown12hIso})`,
    // Dormant venue (incl. never had an event), past 14d → eligible
    `and(or(last_event_imported_at.is.null,last_event_imported_at.lt.${dormantCutoffIso}),last_facebook_scrape.lt.${cooldown14dIso})`,
  ].join(",");

  // ANDed alongside the cooldown clause: skip claimed venues that have
  // had any event added in the last 30 days. The owner is presumed to
  // be maintaining their own listings during that window; scraping on
  // top creates near-duplicates. Unclaimed venues (owner_id IS NULL)
  // and quiet-claimed venues fall through and follow the cooldown above.
  const ownerGraceClause = [
    `owner_id.is.null`,
    `last_event_imported_at.is.null`,
    `last_event_imported_at.lt.${ownerGraceCutoffIso}`,
  ].join(",");

  // For force runs the cooldown is bypassed but we still need to exclude
  // venues processed earlier in THIS chain — otherwise we'd loop forever.
  // The runStart cutoff handles that: venues touched in this chain have
  // last_facebook_scrape >= runStart and get filtered out. Force also
  // bypasses the owner-grace skip — point of force is "scrape this now".
  const forceClause = `last_facebook_scrape.is.null,last_facebook_scrape.lt.${runStartIso}`;

  // Pick N venues with a FB URL, oldest scrape first (NULLS FIRST gives priority
  // to never-scraped venues). When ?city=<slug> is set, restrict to that city.
  const venuesBase = sb
    .from("venues")
    .select("id, name, slug, facebook, owner_id, city_id, city:cities(slug), last_event_imported_at")
    .not("facebook", "is", null)
    .eq("approved", true);
  const withCity = cityIdFilter ? venuesBase.eq("city_id", cityIdFilter) : venuesBase;
  // Force: only the runStart cutoff. Normal: cooldown AND owner-grace.
  // Two .or() chains AND together (each is its own predicate group).
  const venuesQuery = force
    ? withCity.or(forceClause)
    : withCity.or(tieredCooldownClause).or(ownerGraceClause);
  // No offset — every chain link starts at position 0 of the current
  // eligible set. As venues get processed they're filtered out (their
  // last_facebook_scrape becomes >= runStart for force runs, or past the
  // cooldown for scheduled runs), so position 0 naturally advances.
  const { data: venues, error: vErr } = await venuesQuery
    .order("last_facebook_scrape", { ascending: true, nullsFirst: true })
    .range(0, batch - 1);

  // Total venues remaining to process — used to know if more chained
  // invocations are needed after this one. Same filter as the venue
  // picker so the count reflects what's actually scrapable right now.
  const totalBase = sb
    .from("venues")
    .select("id", { count: "exact", head: true })
    .not("facebook", "is", null)
    .eq("approved", true);
  const totalWithCity = cityIdFilter ? totalBase.eq("city_id", cityIdFilter) : totalBase;
  // Mirror the same filter as the picker — must include the owner-grace
  // clause too so the "still to do" count reflects what's actually
  // scrapable, not the larger set including active claimed venues.
  const totalQuery = force
    ? totalWithCity.or(forceClause)
    : totalWithCity.or(tieredCooldownClause).or(ownerGraceClause);
  const { count: totalCount } = await totalQuery;
  const totalVenuesWithFb = totalCount ?? 0;
  if (vErr) {
    return NextResponse.json({ error: `Pick venues: ${vErr.message}` }, { status: 500 });
  }
  if (!venues || venues.length === 0) {
    return NextResponse.json({ ok: true, scraped: 0, eventsCreated: 0, message: "No FB venues to scrape." });
  }

  // Pull genres once for the AI extractor
  const { data: genreRows } = await sb.from("genres").select("id, slug, name").order("name");
  const availableGenres = (genreRows ?? []).map((g) => ({ slug: g.slug, name: g.name }));
  const genreSlugToId = new Map<string, string>();
  for (const g of genreRows ?? []) genreSlugToId.set(g.slug, g.id);

  let totalEvents = 0;
  const perVenue: Array<{ venue: string; posts: number; events: number; skipped: number; error?: string }> = [];

  // Concurrency-limited pool: process venues in parallel up to APIFY_CONCURRENCY
  // at a time (capped by Apify free-tier memory limits — 4GB per actor run,
  // 8GB total → 2 max concurrent). Pool throughput ≈ batch / concurrency × per-venue time.
  async function pool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
    const out: R[] = new Array(items.length);
    let next = 0;
    const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (true) {
        const idx = next++;
        if (idx >= items.length) return;
        out[idx] = await fn(items[idx]);
      }
    });
    await Promise.all(workers);
    return out;
  }

  const venueResults = await pool(venues, APIFY_CONCURRENCY, async (v) => {
    const result = await scrapeAndIngestVenue({
      venue: {
        id: v.id,
        name: v.name,
        facebook: v.facebook!,
        city_id: v.city_id ?? null,
      },
      apifyToken,
      maxPosts,
      availableGenres,
      genreSlugToId,
      dry,
      supabase: sb,
    });

    // Mark this venue as scraped (even on partial failure, so we don't get stuck on it).
    // The shared ingest function deliberately doesn't touch this — the cron
    // owns the cooldown semantics.
    if (!dry) {
      await sb.from("venues").update({ last_facebook_scrape: new Date().toISOString() }).eq("id", v.id);
    }

    return {
      venue: v.name,
      // Internal fields used for the persisted log; not included on the
      // public response shape (the API consumers only see venue/posts/etc).
      _venueId: v.id as string,
      _citySlug: (v.city as any)?.slug ?? null,
      posts: result.posts,
      events: result.events,
      skipped: result.skipped,
      ...(result.error ? { error: result.error } : {}),
    };
  });

  for (const r of venueResults) {
    totalEvents += r.events;
    perVenue.push(r);
  }

  // Persist per-venue results to fb_scrape_venue_runs (sql/058) so the
  // dashboard can show daily Skipped + Errors counts. Best-effort —
  // a failure here doesn't break the scrape response. Skipped on dry
  // runs since dry runs don't represent real activity.
  if (!dry && venueResults.length > 0) {
    try {
      const logRows = venueResults.map((r) => ({
        venue_id: r._venueId,
        venue_name: r.venue,
        city_slug: r._citySlug,
        posts: r.posts,
        events_created: r.events,
        events_skipped: r.skipped,
        // Truncate to keep one rogue stack trace from bloating the row.
        error: (r as any).error ? String((r as any).error).slice(0, 1000) : null,
        forced: force,
      }));
      await sb.from("fb_scrape_venue_runs").insert(logRows);
    } catch (e) {
      // Visibility logging mustn't break the scrape itself. If the table
      // doesn't exist yet (migration not run), this just no-ops.
      console.error("[scrape-facebook] failed to write venue-run log:", e);
    }
  }

  // Fire the next chain link if there's more to do.
  //
  // Chain continues when we got a FULL batch back AND the eligibility
  // count says there are still more venues to process. After each batch,
  // the just-processed venues' last_facebook_scrape > runStart so the
  // next link's query excludes them — no offset needed.
  //
  // CRITICAL: use Next.js's `after()` to keep the chained fetch alive past
  // the response. Without it, Vercel kills the function the moment we return
  // — and the fire-and-forget fetch gets aborted before the request actually
  // goes out, breaking the chain after a couple of links.
  let chained = false;
  if (chain && !dry && venues.length === batch && venues.length < totalVenuesWithFb) {
    const nextUrl = new URL(req.url);
    // Pass runStart so the next link's eligibility filter excludes
    // venues processed in this chain.
    nextUrl.searchParams.set("runStart", runStartIso);
    nextUrl.searchParams.set("batch", String(batch));
    nextUrl.searchParams.set("maxPosts", String(maxPosts));
    nextUrl.searchParams.set("chain", "1");
    // offset is no longer used; remove if a stale client added it
    nextUrl.searchParams.delete("offset");
    const chainedUrl = nextUrl.toString();
    const authHeader = `Bearer ${process.env.CRON_SECRET ?? ""}`;

    after(async () => {
      try {
        await fetch(chainedUrl, {
          method: "GET",
          headers: { Authorization: authHeader },
        });
      } catch (e) {
        // Log so we can spot chain breakages in Vercel function logs.
        console.error("[scrape-facebook] chain fetch failed:", e);
      }
    });
    chained = true;
  }

  // Strip the internal `_venueId` / `_citySlug` fields from the response —
  // they're only needed for the persisted log, not for API consumers.
  const perVenuePublic = perVenue.map((r) => {
    const { _venueId, _citySlug, ...rest } = r as any;
    return rest;
  });

  return NextResponse.json({
    ok: true,
    runStart: runStartIso,
    batch,
    scraped: venues.length,
    totalVenuesWithFb,
    eventsCreated: totalEvents,
    chained,
    dry,
    perVenue: perVenuePublic,
  });
}
