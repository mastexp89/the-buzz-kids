// Per-venue WEBSITE scrape → extract → dedupe → insert pipeline.
//
// The website analogue of scrape-facebook-ingest.ts. Where that one pulls a
// venue's Facebook posts via Apify, this one fetches the venue's own website
// (homepage + common /events, /whats-on subpages via scrapeVenueWebsite),
// runs the kids' AI extractor over each event-ish page, and inserts any new
// events into the review queue (status 'pending') for an admin to vet.
//
// Differences from the FB pipeline, by design:
//   • We KNOW the venue (it's the one whose website we're scraping), so every
//     event attaches straight to venue.id — no per-event venue resolution.
//   • Events land as 'pending' (review queue), not auto-approved. Websites are
//     noisier than a venue's own FB feed, so a human vets before it goes live.
//   • Recurring/multi-day events are kept as ONE row with recurrence metadata,
//     matching the kids extraction contract ("never emit one row per
//     occurrence"). No expandRecurring fan-out.
//
// Like the FB ingest, this function does NOT update venues.last_website_scrape
// or write any run log — the caller (cron) owns those. Errors are returned in
// `error`, never thrown, so one bad venue doesn't kill a batch.

import type { SupabaseClient } from "@supabase/supabase-js";
import { scrapeVenueWebsite } from "@/lib/scrape-website";
import { extractEvents, type ExtractedEvent } from "@/lib/extraction";

// Cap AI extraction calls per venue. Most venues are homepage + 1–2 event
// pages; 3 keeps Anthropic cost predictable on a 900-site sweep.
const DEFAULT_MAX_PAGES = 3;

// Cheap pre-filter: only spend an AI call on a page that actually looks like it
// lists events/dates. Skips "About us" / "Contact" pages that scrapeVenueWebsite
// sometimes returns, which would otherwise burn an extraction call to get [].
const EVENT_SIGNAL = new RegExp(
  [
    "\\bevent", "what.?s on", "\\bupcoming", "\\bworkshop", "\\bclass(es)?\\b",
    "holiday club", "half.?term", "\\bcalendar", "\\bdiary", "book now", "tickets?",
    // month names + day names + a date-ish number give a strong "has dates" signal
    "jan(uary)?|feb(ruary)?|mar(ch)?|apr(il)?|may|jun(e)?|jul(y)?|aug(ust)?|sep(tember)?|oct(ober)?|nov(ember)?|dec(ember)?",
    "monday|tuesday|wednesday|thursday|friday|saturday|sunday",
  ].join("|"),
  "i",
);

// URL path hints that a page is specifically an events/listing page — we
// prioritise these over the homepage when picking which pages to AI-extract.
function isEventyUrl(url: string): boolean {
  return /\/(events?|whats?-?on|gigs?|live-music|upcoming|calendar|diary|classes?|workshops?|tickets?)(\/|$|\?|#)/i.test(url);
}

export type WebsiteVenueForIngest = {
  id: string;
  name: string;
  website: string;
  city_id: string | null;
};

export type WebsiteIngestOptions = {
  venue: WebsiteVenueForIngest;
  availableGenres: Array<{ slug: string; name: string }>;
  genreSlugToId: Map<string, string>;
  // Biases the AI extractor to only return events in areas we cover.
  locationFilter?: { city: string; nearbyAreas?: string[] };
  // Cap pages we run AI over (cost control). 0 / undefined = DEFAULT_MAX_PAGES.
  maxPages?: number;
  // When true, don't write — just count what would happen (cron ?dry=1).
  dry?: boolean;
  // Service-role client (bypasses RLS; we insert unconditionally).
  supabase: SupabaseClient<any, "public", any>;
};

export type WebsiteIngestResult = {
  pagesFetched: number;
  pagesExtracted: number;
  events: number;
  skipped: number;
  error?: string;
};

const norm = (t: string) => (t || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
const hourKey = (iso: string) => {
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}T${pad(t.getUTCHours())}`;
};

export async function scrapeAndIngestVenueWebsite(opts: WebsiteIngestOptions): Promise<WebsiteIngestResult> {
  const { venue: v, availableGenres, genreSlugToId, locationFilter, dry, supabase: sb } = opts;
  const maxPages = Math.max(1, Math.min(6, opts.maxPages || DEFAULT_MAX_PAGES));

  let pagesFetched = 0;
  let pagesExtracted = 0;
  let events = 0;
  let skipped = 0;
  let err: string | undefined;

  try {
    const scrape = await scrapeVenueWebsite(v.website);
    pagesFetched = scrape.pages.length;
    if (scrape.pages.length === 0) {
      return { pagesFetched: 0, pagesExtracted: 0, events: 0, skipped: 0, error: scrape.errors[0] };
    }

    // Pick which pages to AI-extract: event-y URLs first, then the rest, all
    // gated by the cheap event-signal pre-filter, capped at maxPages.
    const ranked = [...scrape.pages].sort((a, b) => Number(isEventyUrl(b.url)) - Number(isEventyUrl(a.url)));
    const toExtract = ranked.filter((p) => EVENT_SIGNAL.test(p.text)).slice(0, maxPages);
    if (toExtract.length === 0) {
      return { pagesFetched, pagesExtracted: 0, events: 0, skipped: 0 };
    }

    // Build the dedupe set ONCE from existing events at this venue (incl.
    // pending — so re-scraping doesn't pile duplicates into the queue).
    const { data: existing } = await sb
      .from("events")
      .select("title, start_time")
      .eq("venue_id", v.id)
      .neq("status", "rejected");
    const seen = new Set<string>();
    const titlesByHour = new Map<string, string[]>();
    for (const e of existing ?? []) {
      const hk = hourKey(e.start_time);
      const nt = norm(e.title);
      seen.add(`${nt}|${hk}`);
      const list = titlesByHour.get(hk) ?? [];
      list.push(nt);
      titlesByHour.set(hk, list);
    }

    // Drop events that have already finished — venue sites list archives /
    // past exhibitions and the extractor happily pulls them, which just
    // clutters the review queue. An event survives if its END is today or
    // later, so a still-running exhibition (past start, future end_date)
    // is kept; only genuinely-over events are dropped.
    const todayStart = new Date();
    todayStart.setUTCHours(0, 0, 0, 0);
    const hasFinished = (e: ExtractedEvent): boolean => {
      const end = e.end_date
        ? new Date(`${e.end_date}T23:59:59Z`)
        : e.ends_at
        ? new Date(e.ends_at)
        : new Date(e.starts_at);
      return !Number.isNaN(end.getTime()) && end < todayStart;
    };

    for (const page of toExtract) {
      try {
        const extraction = await extractEvents({
          venueName: v.name,
          postedAt: new Date().toISOString(),
          textContent: page.text || null,
          imageUrls: page.imageUrls.slice(0, 3),
          availableCategories: availableGenres,
          locationFilter,
        });
        pagesExtracted++;
        const valid = (extraction.events ?? []).filter((e) => {
          if (!e.title || !e.title.trim()) return false;
          if (!e.starts_at) return false;
          if (Number.isNaN(new Date(e.starts_at).getTime())) return false;
          if (hasFinished(e)) { skipped++; return false; }
          return true;
        });
        if (valid.length === 0) continue;

        const rows: Array<Record<string, unknown>> = [];
        const drafts: ExtractedEvent[] = [];
        for (const e of valid) {
          const hk = hourKey(e.starts_at);
          const nt = norm(e.title);
          if (seen.has(`${nt}|${hk}`)) { skipped++; continue; }
          const sameHour = titlesByHour.get(hk) ?? [];
          const overlap = sameHour.find(
            (t) => nt.length >= 6 && t.length >= 6 && (t.includes(nt) || nt.includes(t)),
          );
          if (overlap) { skipped++; continue; }
          seen.add(`${nt}|${hk}`);
          sameHour.push(nt);
          titlesByHour.set(hk, sameHour);

          const poster = page.imageUrls[0] ?? null;
          rows.push({
            venue_id: v.id,
            city_id: v.city_id,
            title: e.title.slice(0, 200),
            start_time: e.starts_at,
            end_time: e.ends_at,
            end_date: e.end_date || null,
            description: (e.description ?? "").slice(0, 2000) || null,
            status: "pending",
            auto_imported_from: "website",
            auto_import_confidence: e.confidence,
            auto_import_source_url: page.url,
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
            ticket_url: e.ticket_url ?? page.url,
          });
          drafts.push(e);
        }

        if (rows.length === 0 || dry) { events += rows.length; continue; }

        const { data: created, error: insErr } = await sb.from("events").insert(rows).select("id");
        if (insErr) { err = `Insert: ${insErr.message}`; continue; }
        if (!created) continue;
        events += created.length;

        // Link categories (best-effort).
        for (let i = 0; i < created.length; i++) {
          const gLinks = (drafts[i].categories ?? [])
            .map((s) => genreSlugToId.get(s))
            .filter((id): id is string => !!id)
            .map((gid) => ({ event_id: created[i].id, genre_id: gid }));
          if (gLinks.length > 0) await sb.from("event_genres").insert(gLinks);
        }
      } catch (pageErr: any) {
        err = (err ? err + "; " : "") + `Extract ${page.url}: ${pageErr?.message ?? pageErr}`;
      }
    }
  } catch (e: any) {
    err = `Website scrape: ${e?.message ?? e}`;
  }

  return { pagesFetched, pagesExtracted, events, skipped, ...(err ? { error: err } : {}) };
}
