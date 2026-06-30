// Vercel Cron: auto-check venue WEBSITES for kids' events.
//
// The Buzz Kids has ~900 venues with a real website but almost no Facebook
// URLs, so the FB scrape cron is idle here. This cron fetches each venue's
// own site (homepage + /events, /whats-on subpages), AI-extracts kids'
// events, and drops anything new into the REVIEW QUEUE (events.status =
// 'pending') for an admin to vet on /admin/queue.
//
// Deliberately conservative vs the FB cron:
//   • Review queue, not auto-publish — websites are noisier than a venue's
//     own feed, so a human approves before anything goes live.
//   • Active cities only (start where we're live, widen later).
//   • NO self-chaining — each scheduled tick processes ONE batch and stops.
//     The schedule provides throughput; this bounds how fast the review
//     queue fills so it never floods. A 30-day cooldown spreads the ~900
//     sites across many run-days, then keeps them refreshed.
//
// Auth: Vercel sends `Authorization: Bearer ${CRON_SECRET}`. We verify it.
//
// Query params (admin overrides):
//   ?batch=N     venues this run (default 6, max 30)
//   ?city=slug   restrict to one city's venues (e.g. first manual runs)
//   ?force=1     ignore the cooldown (scrape even recently-done venues)
//   ?maxPages=N  AI-extract at most N pages per venue (default 3)
//   ?dry=1       skip all writes; just report what would happen

import { NextResponse, after } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { scrapeAndIngestVenueWebsite } from "@/lib/scrape-website-ingest";

export const maxDuration = 300;

const DEFAULT_BATCH = 10;
// Websites change slowly and this also bounds the review-queue fill rate:
// a long cooldown means each run-day only ever touches fresh venues.
const RESCRAPE_COOLDOWN_DAYS = 30;
// Two venues at a time. Site fetches are I/O-bound (fine to parallelise);
// within a venue the AI calls stay sequential, so at most 2 extractEvents
// run concurrently — comfortably under Anthropic's low-tier token/min.
const CONCURRENCY = 2;

export async function GET(req: Request) {
  const auth = req.headers.get("authorization");
  const expected = `Bearer ${process.env.CRON_SECRET ?? ""}`;
  if (!process.env.CRON_SECRET || auth !== expected) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }

  const url = new URL(req.url);
  const batch = Math.max(1, Math.min(30, Number(url.searchParams.get("batch") ?? DEFAULT_BATCH)));
  const maxPages = Math.max(1, Math.min(6, Number(url.searchParams.get("maxPages") ?? 3)));
  const dry = url.searchParams.get("dry") === "1";
  const force = url.searchParams.get("force") === "1";
  const cityFilterSlug = url.searchParams.get("city");
  // Self-chain so one trigger sweeps every eligible venue instead of a single
  // batch. Processed venues get last_website_scrape=now and fall out of the
  // cooldown query, so each chained call naturally picks up the next batch.
  // Default ON; pass chain=0 for a single gentle batch.
  const chain = url.searchParams.get("chain") !== "0";

  const sb = createServiceClient();

  // Active cities, with name + nearby_areas for the per-venue location filter.
  const { data: cityRows } = await sb
    .from("cities")
    .select("id, name, slug, nearby_areas, active")
    .eq("active", true);
  const activeCities = cityRows ?? [];
  const cityById = new Map(activeCities.map((c: any) => [c.id, c]));

  let cityIdFilter: string | null = null;
  if (cityFilterSlug) {
    const c = activeCities.find((x: any) => x.slug === cityFilterSlug);
    if (!c) return NextResponse.json({ error: `Unknown / inactive city "${cityFilterSlug}"` }, { status: 400 });
    cityIdFilter = c.id;
  }

  const activeCityIds = cityIdFilter ? [cityIdFilter] : activeCities.map((c: any) => c.id);
  if (activeCityIds.length === 0) {
    return NextResponse.json({ ok: true, scraped: 0, message: "No active cities." });
  }

  const cooldownIso = new Date(Date.now() - RESCRAPE_COOLDOWN_DAYS * 24 * 60 * 60 * 1000).toISOString();

  // Eligible venues: approved, in an active city, with a non-Facebook website,
  // never scraped or past the cooldown. Oldest-scrape-first (NULLS FIRST).
  let q = sb
    .from("venues")
    .select("id, name, website, city_id, last_website_scrape")
    .eq("approved", true)
    .in("city_id", activeCityIds)
    .not("website", "is", null)
    .not("website", "ilike", "*facebook.com*");
  if (!force) q = q.or(`last_website_scrape.is.null,last_website_scrape.lt.${cooldownIso}`);
  const { data: venues, error: vErr } = await q
    .order("last_website_scrape", { ascending: true, nullsFirst: true })
    .range(0, batch - 1);

  if (vErr) return NextResponse.json({ error: `Pick venues: ${vErr.message}` }, { status: 500 });
  if (!venues || venues.length === 0) {
    return NextResponse.json({ ok: true, scraped: 0, eventsCreated: 0, message: "No eligible venues." });
  }

  // Genres once for the extractor.
  const { data: genreRows } = await sb.from("genres").select("id, slug, name").order("name");
  const availableGenres = (genreRows ?? []).map((g: any) => ({ slug: g.slug, name: g.name }));
  const genreSlugToId = new Map<string, string>();
  for (const g of genreRows ?? []) genreSlugToId.set(g.slug, g.id);

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

  let totalEvents = 0;
  const perVenue = await pool(venues, CONCURRENCY, async (v: any) => {
    const city = v.city_id ? cityById.get(v.city_id) : null;
    const locationFilter = city
      ? { city: city.name as string, nearbyAreas: (city.nearby_areas as string[] | null) ?? [] }
      : undefined;

    const r = await scrapeAndIngestVenueWebsite({
      venue: { id: v.id, name: v.name, website: v.website, city_id: v.city_id ?? null },
      availableGenres,
      genreSlugToId,
      locationFilter,
      maxPages,
      dry,
      supabase: sb,
    });

    // Mark scraped (even on partial failure) so we don't get stuck on one venue.
    if (!dry) {
      await sb.from("venues").update({ last_website_scrape: new Date().toISOString() }).eq("id", v.id);
    }

    totalEvents += r.events;
    return {
      venue: v.name,
      _venueId: v.id as string,
      _website: v.website as string,
      _citySlug: (city?.slug as string) ?? null,
      pagesFetched: r.pagesFetched,
      pagesExtracted: r.pagesExtracted,
      events: r.events,
      skipped: r.skipped,
      ...(r.error ? { error: r.error } : {}),
    };
  });

  // Persist the per-venue run log (best-effort; mustn't break the response).
  if (!dry && perVenue.length > 0) {
    try {
      const rows = perVenue.map((r: any) => ({
        venue_id: r._venueId,
        venue_name: r.venue,
        city_slug: r._citySlug,
        website: r._website,
        pages_fetched: r.pagesFetched,
        pages_extracted: r.pagesExtracted,
        events_created: r.events,
        events_skipped: r.skipped,
        error: r.error ? String(r.error).slice(0, 1000) : null,
        forced: force,
      }));
      await sb.from("website_scrape_venue_runs").insert(rows);
    } catch (e) {
      console.error("[scrape-websites] failed to write run log:", e);
    }
  }

  const perVenuePublic = perVenue.map((r: any) => {
    const { _venueId, _website, _citySlug, ...rest } = r;
    return rest;
  });

  // Fire the next chain link if we got a full batch (i.e. more venues likely
  // remain). Uses Next's after() so the fetch survives past this response —
  // without it Vercel kills the function and the chained call never goes out.
  // The 30-day cooldown excludes the venues we just stamped, so the next link
  // advances naturally with no offset/cursor needed.
  let chained = false;
  if (chain && !dry && venues.length === batch) {
    const nextUrl = new URL(req.url);
    nextUrl.searchParams.set("chain", "1");
    const chainedUrl = nextUrl.toString();
    const authHeader = `Bearer ${process.env.CRON_SECRET ?? ""}`;
    after(async () => {
      try {
        await fetch(chainedUrl, { method: "GET", headers: { Authorization: authHeader } });
      } catch (e) {
        console.error("[scrape-websites] chain fetch failed:", e);
      }
    });
    chained = true;
  }

  return NextResponse.json({
    ok: true,
    scraped: venues.length,
    eventsCreated: totalEvents,
    queuedForReview: totalEvents,
    city: cityFilterSlug ?? "(all active)",
    chained,
    dry,
    perVenue: perVenuePublic,
  });
}
