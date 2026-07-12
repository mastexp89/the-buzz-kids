// Scheduled aggregator ingest — the hands-off engine behind the cron.
//
// For each active portal feed: sweep its detail links, skip ones we've already
// processed (aggregator_seen), AI-extract the NEW ones, and drop events into
// the REVIEW QUEUE (events.status = 'pending', standalone) + attractions into
// edit_suggestions as new-place requests. Everything is reviewed by a human —
// "hands off" means no manual triggering, not auto-publish.

import { createServiceClient } from "@/lib/supabase/service";
import { fetchRawHtml, htmlToScrapedPage } from "@/lib/scrape-website";
import { sweepListingUrls } from "@/lib/aggregator";
import { extractEvents, type ExtractedEvent, type ExtractedPlace } from "@/lib/extraction";

const norm = (s: string) => (s || "").toLowerCase().replace(/[^a-z0-9]+/g, "");

export type AggregatorRunResult = {
  sourcesRun: number;
  detailUrlsFound: number;
  newUrls: number;
  processed: number;
  events: number;
  places: number;
  skippedSeen: number;
  warnings: string[];
  dry: boolean;
};

// batch = max NEW detail pages to AI-extract this run (the cost/time bound).
export async function runAggregatorImport(opts: { batch?: number; dry?: boolean } = {}): Promise<AggregatorRunResult> {
  const sb = createServiceClient();
  const dry = !!opts.dry;
  let budget = Math.max(1, Math.min(80, opts.batch ?? 25));

  const res: AggregatorRunResult = {
    sourcesRun: 0, detailUrlsFound: 0, newUrls: 0, processed: 0,
    events: 0, places: 0, skippedSeen: 0, warnings: [], dry,
  };

  const { data: sources } = await sb
    .from("aggregator_sources").select("*").eq("active", true)
    .order("last_run_at", { ascending: true, nullsFirst: true });
  if (!sources || sources.length === 0) return res;

  // Genre slug → id (for event_genres links).
  const { data: genres } = await sb.from("genres").select("slug, name");
  const genreSlugToId = new Map<string, string>();
  const availableGenres = (genres ?? []).map((g: any) => {
    genreSlugToId.set(g.slug, g.id);
    return { slug: g.slug, name: g.name };
  });

  // Cities for the location filter + city_id tagging.
  const { data: cities } = await sb.from("cities").select("id, name, slug, nearby_areas");
  const cityBySlug = new Map<string, any>((cities ?? []).map((c: any) => [c.slug, c]));

  // Existing venue names, to skip place suggestions we already list.
  const { data: venues } = await sb.from("venues").select("name").limit(10000);
  const existingVenues = new Set((venues ?? []).map((v: any) => norm(v.name)));

  for (const src of sources) {
    if (budget <= 0) break;
    res.sourcesRun++;

    const city = src.city_slug ? cityBySlug.get(src.city_slug) : null;
    const cityId: string | null = city?.id ?? null;
    const locationFilter = city
      ? { city: city.name as string, nearbyAreas: (city.nearby_areas ?? []) as string[] }
      : undefined;

    // Sweep this source into detail-page URLs.
    const { detailUrls, warnings } = await sweepListingUrls([src.url], { paginationCap: 10 });
    res.warnings.push(...warnings);
    res.detailUrlsFound += detailUrls.length;

    // Drop the ones we've already processed.
    const { data: seenRows } = await sb
      .from("aggregator_seen").select("source_url")
      .in("source_url", detailUrls.length ? detailUrls : ["__none__"]);
    const seen = new Set((seenRows ?? []).map((r: any) => r.source_url));
    const fresh = detailUrls.filter((u) => !seen.has(u));
    res.skippedSeen += detailUrls.length - fresh.length;
    res.newUrls += fresh.length;

    // Dry run is a FREE preview: report the sweep (how many new listings are
    // waiting) without paying to AI-extract or writing anything.
    if (dry) continue;

    const take = fresh.slice(0, budget);
    let srcEvents = 0;
    let srcPlaces = 0;

    for (const url of take) {
      budget--;
      res.processed++;
      const raw = await fetchRawHtml(url);
      if ("error" in raw) { res.warnings.push(`${url}: ${raw.error}`); continue; }
      const page = htmlToScrapedPage(raw.html, raw.finalUrl);
      if (page.text.length < 60) {
        if (!dry) await markSeen(sb, raw.finalUrl, src.id, "none", null);
        continue;
      }

      let extraction;
      try {
        extraction = await extractEvents({
          venueName: "(from a listings page)",
          postedAt: new Date().toISOString(),
          textContent: page.text,
          imageUrls: page.imageUrls.slice(0, 3),
          availableCategories: availableGenres,
          locationFilter,
          detectPlaces: true,
        });
      } catch (e: any) {
        res.warnings.push(`${url}: ${e?.message ?? "extraction failed"}`);
        continue;
      }

      const poster = page.imageUrls[0] ?? null;

      // Events → standalone pending rows in the review queue.
      if (extraction.events.length > 0 && cityId) {
        if (!dry) {
          const rows = extraction.events.map((e: ExtractedEvent) => ({
            venue_id: null,
            city_id: cityId,
            location_name: e.venue_hint || null,
            title: e.title.slice(0, 200),
            start_time: e.starts_at,
            end_time: e.ends_at,
            end_date: e.end_date || null,
            description: (e.description ?? "").slice(0, 2000) || null,
            status: "pending",
            auto_imported_from: "aggregator",
            auto_import_confidence: e.confidence,
            auto_import_source_url: raw.finalUrl,
            auto_import_image_url: poster,
            image_url: poster,
            age_min: e.age_min,
            age_max: e.age_max,
            is_free: !!e.is_free,
            price_from: e.is_free ? 0 : (e.price_from ?? null),
            booking_required: !!e.booking_required,
            setting: e.setting,
            accessibility: e.accessibility?.length ? e.accessibility : [],
            recurrence_pattern: e.recurring?.pattern ?? null,
            recurrence_until: e.recurring?.until ?? null,
            ticket_url: e.ticket_url ?? raw.finalUrl,
          }));
          const { data: created, error: insErr } = await sb.from("events").insert(rows).select("id");
          if (insErr) {
            res.warnings.push(`${url}: event insert ${insErr.message}`);
          } else if (created) {
            srcEvents += created.length;
            for (let i = 0; i < created.length; i++) {
              const gl = (extraction.events[i].categories ?? [])
                .map((s) => genreSlugToId.get(s))
                .filter((id): id is string => !!id)
                .map((gid) => ({ event_id: created[i].id, genre_id: gid }));
              if (gl.length) await sb.from("event_genres").insert(gl);
            }
          }
        } else {
          srcEvents += extraction.events.length;
        }
      } else if (extraction.events.length > 0 && !cityId) {
        res.warnings.push(`${url}: ${extraction.events.length} event(s) skipped — source has no resolvable city_slug ('${src.city_slug}')`);
      }

      // Places: just COUNT the new ones (skip ones already in the directory).
      // We deliberately do NOT file them as edit_suggestions — that fires the
      // new-suggestion email trigger and floods the inbox on a bulk run. The
      // place URLs are still marked seen below so they're not re-processed;
      // events (the real value) go to the review queue as normal.
      for (const pl of extraction.places as ExtractedPlace[]) {
        if (existingVenues.has(norm(pl.name))) continue;
        srcPlaces++;
        existingVenues.add(norm(pl.name)); // avoid double-counting within the run
      }

      if (!dry) {
        await markSeen(
          sb, raw.finalUrl, src.id,
          extraction.events.length ? "event" : (extraction.places.length ? "place" : "none"),
          extraction.events[0]?.title ?? extraction.places[0]?.name ?? null,
        );
      }
    }

    res.events += srcEvents;
    res.places += srcPlaces;
    if (!dry) {
      await sb.from("aggregator_sources")
        .update({ last_run_at: new Date().toISOString(), last_new_events: srcEvents, last_new_places: srcPlaces })
        .eq("id", src.id);
    }
  }

  return res;
}

async function markSeen(sb: any, url: string, sourceId: string, kind: string, title: string | null) {
  await sb.from("aggregator_seen").upsert(
    { source_url: url, aggregator_source_id: sourceId, kind, title },
    { onConflict: "source_url", ignoreDuplicates: true },
  );
}
