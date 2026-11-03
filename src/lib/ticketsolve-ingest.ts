// Weekly import from venues' Ticketsolve box offices. Ticketsolve publishes a
// public listings feed at <box office>/shows.xml with every show, its
// category, blurb, poster and each performance's exact date/time.
//
// Flow per show:
//   1. Already on the site (same feed URL, or same title at the same venue on
//      an overlapping date — e.g. one added by hand)? Claim/refresh it, done.
//   2. Cheap keyword filter — concerts and stand-up only get an AI look when
//      the blurb mentions families/kids; adult-flagged shows are skipped.
//   3. AI read (same extractor as the website scraper) for for_kids,
//      categories, ages and a neutral description. Dates come from the FEED,
//      never the AI, so they can't be misread.
//   4. Not for kids → skipped. Otherwise the usual auto-approve rule decides:
//      confident + categorised → live; anything else → the Telegram queue.

import type { SupabaseClient } from "@supabase/supabase-js";
import { extractEvents } from "@/lib/extraction";
import { shouldAutoApprove } from "@/lib/auto-approve";

// Add more Ticketsolve venues here (venue slug on The Buzz Kids + feed URL).
export const TICKETSOLVE_FEEDS: { venueSlug: string; feedUrl: string }[] = [
  { venueSlug: "whitehall-theatre", feedUrl: "https://dundeetickets.whitehalltheatre.com/shows.xml" },
];

type FeedShow = {
  id: string;
  name: string;
  category: string;
  description: string;
  url: string;
  image: string | null;
  times: string[]; // ISO 8601, sorted
};

export type TicketsolveResult = {
  feeds: number;
  shows: number;
  candidates: number;
  added: number;
  autoApproved: number;
  queued: number;
  updated: number;
  skipped: number;
  errors: string[];
};

const FAMILY_RE = /\bfamil(y|ies)\b|\bchild(ren)?\b|\bkids?\b|little ones|all ages|pantomime|\bpanto\b|\bsanta\b|toddler|\btots\b|\bbaby\b|\bbabies\b/i;
const MAYBE_CATEGORY_RE = /famil|child|kids|panto|dance|musical|drama|circus|puppet|magic|story/i;
const ADULT_RE = /\b(18\+|16\+|over 18s?|adults? only|strong language|mature content|not suitable for (children|under))/i;

function decode(s: string): string {
  return s
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

function tagText(block: string, tag: string): string | null {
  const m = block.match(new RegExp(`<${tag}[^>]*>\\s*(?:<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>|([\\s\\S]*?))\\s*</${tag}>`));
  if (!m) return null;
  return (m[1] ?? m[2] ?? "").trim();
}

function plain(htmlish: string): string {
  return decode(htmlish.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

export function parseTicketsolveFeed(xml: string): FeedShow[] {
  const shows: FeedShow[] = [];
  for (const m of xml.matchAll(/<show id="(\d+)">([\s\S]*?)<\/show>/g)) {
    const [, id, block] = m;
    // The show's own <url> sits before <images>/<events>, which have their own.
    const head = block.split(/<images>|<events>/)[0];
    const url = tagText(head, "url");
    const img = block.match(/<url size="large">\s*(?:<!\[CDATA\[)?\s*([^<\]\s]+)/)?.[1] ?? null;
    const times = Array.from(block.matchAll(/<date_time_iso[^>]*>\s*(?:<!\[CDATA\[)?\s*([^<\]\s]+)/g))
      .map((x) => x[1])
      .filter((t) => !Number.isNaN(new Date(t).getTime()))
      .sort();
    shows.push({
      id,
      name: plain(tagText(block, "name") ?? ""),
      category: plain(tagText(block, "event_category") ?? ""),
      description: plain(tagText(block, "description") ?? ""),
      url: url ?? "",
      image: img,
      times,
    });
  }
  return shows.filter((s) => s.name && s.url && s.times.length > 0);
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const ukDate = (iso: string) => new Date(iso).toLocaleDateString("en-CA", { timeZone: "Europe/London" });
const ukTime = (iso: string) =>
  new Date(iso).toLocaleTimeString("en-GB", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: "Europe/London" })
    .replace(":00", "").replace(" ", "");

export async function ingestTicketsolve(sb: SupabaseClient, opts: { dry?: boolean } = {}): Promise<TicketsolveResult> {
  const res: TicketsolveResult = {
    feeds: 0, shows: 0, candidates: 0, added: 0, autoApproved: 0, queued: 0, updated: 0, skipped: 0, errors: [],
  };

  const { data: genreRows } = await sb.from("genres").select("id, slug, name");
  const genreSlugToId = new Map<string, string>();
  const availableGenres = (genreRows ?? []).map((g: any) => {
    genreSlugToId.set(g.slug, g.id);
    return { slug: g.slug, name: g.name };
  });

  for (const feed of TICKETSOLVE_FEEDS) {
    const { data: venue } = await sb
      .from("venues")
      .select("id, name, city_id, approved, city:cities(name)")
      .eq("slug", feed.venueSlug)
      .maybeSingle();
    if (!venue || !venue.approved) { res.errors.push(`${feed.venueSlug}: venue missing or not approved`); continue; }

    let xml: string;
    try {
      const r = await fetch(feed.feedUrl, {
        headers: { "User-Agent": "TheBuzzKidsBot/1.0 (+https://www.thebuzzkids.co.uk)" },
        signal: AbortSignal.timeout(30_000),
      });
      if (!r.ok) { res.errors.push(`${feed.venueSlug}: feed HTTP ${r.status}`); continue; }
      xml = await r.text();
    } catch (e: any) {
      res.errors.push(`${feed.venueSlug}: ${e?.message ?? e}`);
      continue;
    }
    res.feeds++;

    const nowMs = Date.now();
    const shows = parseTicketsolveFeed(xml).filter((s) => new Date(s.times[s.times.length - 1]).getTime() >= nowMs);
    res.shows += shows.length;

    const { data: existing } = await sb
      .from("events")
      .select("id, title, start_time, end_date, auto_import_source_url")
      .eq("venue_id", venue.id);

    for (const s of shows) {
      const firstDay = ukDate(s.times[0]);
      const lastDay = ukDate(s.times[s.times.length - 1]);
      const multiDay = firstDay !== lastDay;
      const nt = norm(s.name);

      // 1) Already listed?
      const match = (existing ?? []).find((e: any) => {
        if (e.auto_import_source_url && e.auto_import_source_url === s.url) return true;
        const et = norm(e.title ?? "");
        const titleHit = et.length >= 5 && nt.length >= 5 && (et.includes(nt) || nt.includes(et));
        const d = ukDate(e.start_time);
        return titleHit && d >= firstDay && d <= lastDay;
      });
      if (match) {
        const upd: Record<string, unknown> = {};
        if (match.auto_import_source_url !== s.url) upd.auto_import_source_url = s.url;
        if (multiDay && match.end_date !== lastDay) upd.end_date = lastDay;
        if (Object.keys(upd).length && !opts.dry) {
          await sb.from("events").update(upd).eq("id", match.id);
          res.updated++;
        }
        continue;
      }

      // 2) Cheap filter before paying for an AI read.
      const text = `${s.name} ${s.description}`;
      const candidate = (FAMILY_RE.test(text) || MAYBE_CATEGORY_RE.test(s.category)) && !ADULT_RE.test(text);
      if (!candidate) { res.skipped++; continue; }
      res.candidates++;
      if (opts.dry) continue;

      // 3) AI read for suitability, categories and a neutral description.
      const sameDay = s.times.filter((t) => ukDate(t) === firstDay);
      const perfList = s.times.map((t) => `${ukDate(t)} ${ukTime(t)}`).join(", ");
      let ex;
      try {
        const out = await extractEvents({
          venueName: venue.name,
          postedAt: new Date().toISOString(),
          textContent:
            `${s.name}\nCategory: ${s.category || "—"}\nVenue: ${venue.name}, ${(venue as any).city?.name ?? ""}\n` +
            `Performances: ${perfList}\n\n${s.description}`.slice(0, 6000),
          availableCategories: availableGenres,
        });
        ex = out.events?.[0];
      } catch (e: any) {
        res.errors.push(`${s.name}: AI ${e?.message ?? e}`.slice(0, 200));
        continue;
      }
      if (!ex || !ex.for_kids) {
        // Remember the verdict as a declined row so next week's run matches it
        // in step 1 and doesn't pay for the same AI read again.
        await sb.from("events").insert({
          venue_id: venue.id,
          city_id: venue.city_id,
          title: s.name.slice(0, 200),
          start_time: s.times[0],
          end_date: multiDay ? lastDay : null,
          status: "rejected",
          reviewed_at: new Date().toISOString(),
          auto_imported_from: "website",
          auto_import_confidence: ex?.confidence ?? null,
          auto_import_source_url: s.url,
          cancelled: false,
        });
        res.skipped++;
        continue;
      }

      // 4) Insert — dates from the feed, not the AI.
      const genreIds = (ex.categories ?? []).map((c) => genreSlugToId.get(c)).filter((x): x is string => !!x);
      const auto = shouldAutoApprove({ forKids: true, genreCount: genreIds.length, confidence: ex.confidence, ageMin: ex.age_min });
      let description = (ex.description ?? "").trim();
      if (!multiDay && sameDay.length > 1) {
        const ts = sameDay.map(ukTime);
        description += ` Shows at ${ts.slice(0, -1).join(", ")} and ${ts[ts.length - 1]}.`;
      } else if (multiDay) {
        description += ` ${s.times.length} performances from ${new Date(s.times[0]).toLocaleDateString("en-GB", { day: "numeric", month: "long", timeZone: "Europe/London" })} to ${new Date(s.times[s.times.length - 1]).toLocaleDateString("en-GB", { day: "numeric", month: "long", timeZone: "Europe/London" })}.`;
      }

      const { data: created, error } = await sb
        .from("events")
        .insert({
          venue_id: venue.id,
          city_id: venue.city_id,
          title: s.name.slice(0, 200),
          start_time: s.times[0],
          end_date: multiDay ? lastDay : null,
          description: description.slice(0, 2000) || null,
          status: auto ? "approved" : "pending",
          reviewed_at: auto ? new Date().toISOString() : null,
          auto_imported_from: "website",
          auto_import_confidence: ex.confidence,
          auto_import_source_url: s.url,
          auto_import_image_url: s.image,
          image_url: s.image,
          age_min: ex.age_min,
          age_max: ex.age_max,
          is_free: false,
          price_from: ex.price_from ?? null,
          booking_required: true,
          setting: "indoor",
          accessibility: ex.accessibility?.length ? ex.accessibility : [],
          ticket_url: s.url,
          cancelled: false,
        })
        .select("id")
        .single();
      if (error || !created) { res.errors.push(`${s.name}: insert ${error?.message}`); continue; }
      if (genreIds.length) {
        await sb.from("event_genres").insert(genreIds.map((gid) => ({ event_id: created.id, genre_id: gid })));
      }
      res.added++;
      if (auto) res.autoApproved++; else res.queued++;
    }
  }
  return res;
}
