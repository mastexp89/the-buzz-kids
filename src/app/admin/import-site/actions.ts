"use server";

// Multi-venue site importer.
//
// Use case: a promoter / aggregator site (e.g. Icebreaker Comedy) that lists
// gigs at lots of different venues. We can't tie it to a single venue like
// our normal venue website scrape — we need to extract each event WITH a
// venue hint, then resolve the venue per-event in the review UI.
//
// Flow:
//   1. Admin pastes a URL (an index / "upcoming events" page).
//   2. We fetch the index, pull event-detail links out of the HTML.
//   3. For each detail link (capped to keep within timeout), fetch + AI extract.
//   4. Return drafts shaped like QuickDraft so the review UI can stay shared.
//
// All extraction is read-only — admin reviews + maps venues + clicks Publish
// in the existing Quick Import publish action (which handles venue creation).

import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { extractEvents, type ExtractedEvent, type ExtractedPlace } from "@/lib/extraction";
import { fetchRawHtml, extractAnchorUrls, htmlToScrapedPage } from "@/lib/scrape-website";
import {
  applyArtistMatchesToDrafts,
  type QuickDraft,
  type QuickDraftArtist,
} from "../quick-import/actions";

// Cap detail-page fetches per import run. Each detail page = one Anthropic call,
// so this is the dominant cost / time. 20 is a sensible default for human review.
const MAX_DETAIL_PAGES = 20;

// Build the location filter from the cities table. Each active city carries
// its own `nearby_areas` array; we union them all into a single allowlist
// so the AI extractor only returns events from somewhere we cover.
//
// The prompt reads "venues in <primary> or <area1>, <area2>, ..." so we
// pick "Dundee" as primary (always present) and shove every other active
// city's name + nearby_areas into the area list. Result: a multi-city
// allowlist with no code changes when admins add new towns to a city's
// nearby_areas via SQL.
async function buildAllowedLocation(sb: ReturnType<typeof createServiceClient>) {
  const { data } = await sb
    .from("cities")
    .select("name, nearby_areas, active")
    .eq("active", true);
  const cities = (data ?? []) as Array<{ name: string; nearby_areas: string[] | null }>;

  if (cities.length === 0) {
    // Empty / unmigrated DB — fall back to the original hardcoded values.
    return { city: "Dundee", nearbyAreas: ["Broughty Ferry"] };
  }

  // Prefer Dundee as the prompt's primary if present (keeps the wording
  // matching what the AI was originally trained on); otherwise use the
  // first active city.
  const primary = cities.find((c) => c.name.toLowerCase() === "dundee") ?? cities[0];
  const others = cities.filter((c) => c !== primary);

  const nearby = new Set<string>();
  for (const a of primary.nearby_areas ?? []) nearby.add(a);
  for (const c of others) {
    nearby.add(c.name);
    for (const a of c.nearby_areas ?? []) nearby.add(a);
  }

  return { city: primary.name, nearbyAreas: Array.from(nearby) };
}

async function requireAdmin() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: prof } = await supabase
    .from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (prof?.role !== "admin") return null;
  return { userId: user.id };
}

// Heuristics that pick out URLs that LOOK like individual event-detail pages
// rather than nav links, blog posts, social media etc. Stay generous —
// admin can prune in the review screen if anything irrelevant slips through.
function looksLikeEventDetail(linkUrl: URL, baseOrigin: string): boolean {
  // Same-origin only
  if (linkUrl.origin !== baseOrigin) return false;

  const path = linkUrl.pathname.toLowerCase();

  // Reject obvious noise
  if (
    /\.(jpg|jpeg|png|webp|gif|pdf|zip|mp3|mp4|css|js|svg|ico)$/.test(path) ||
    /^\/wp-(admin|content|json|login)/.test(path) ||
    /^\/(cart|checkout|account|my-account|basket|terms|privacy|contact|about|search|tag|category|author|feed|rss|comments|wp-)/i.test(path) ||
    // Category / archive listing pages and pagination are NOT event details —
    // "/whats-on-category/..." and any ".../page/2/" or ".../feed/".
    /-category\//.test(path) ||
    /\/page\/\d+\/?$/.test(path) ||
    /\/feed\/?$/.test(path) ||
    path === "/" ||
    path.length < 4
  ) return false;

  // Strong positive signals: path contains an event-y segment.
  const positiveTokens = [
    "/event", "/events/", "/whats-on", "/gig", "/show", "/shows/",
    "/upcoming", "/listing", "/tickets/", "/gigs/", "/shop/event",
  ];
  for (const tok of positiveTokens) {
    if (path.includes(tok)) return true;
  }

  return false;
}

// An ongoing attraction the importer found on a listings page — routed to
// the admin as "add this as a place", separate from the event drafts.
export type PlaceDraft = {
  name: string;
  location: string | null;
  description: string;
  website: string | null;
  sourceUrl: string;
  alreadyExists: boolean; // a venue of this name is already in the directory
};

export type SiteImportResult =
  | {
      ok: true;
      indexUrl: string;
      pagesFetched: number;
      pagesSkipped: number;
      drafts: QuickDraft[];
      places?: PlaceDraft[];
      warnings: string[];
    }
  | { error: string };

const normName = (s: string) => (s || "").toLowerCase().replace(/[^a-z0-9]+/g, "");

// Turn raw extracted places into deduped drafts, flagging any that already
// exist in the venues directory so the admin doesn't add duplicates.
async function toPlaceDrafts(
  sb: ReturnType<typeof createServiceClient>,
  raw: { place: ExtractedPlace; sourceUrl: string }[],
): Promise<PlaceDraft[]> {
  if (raw.length === 0) return [];
  const { data: venues } = await sb.from("venues").select("name").limit(10000);
  const existing = new Set((venues ?? []).map((v: any) => normName(v.name)));
  const seen = new Set<string>();
  const out: PlaceDraft[] = [];
  for (const { place, sourceUrl } of raw) {
    const key = normName(place.name);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push({
      name: place.name,
      location: place.location,
      description: place.description,
      website: place.website,
      sourceUrl,
      alreadyExists: existing.has(key),
    });
  }
  return out;
}

// Pagination discovery: find "?/page/N/" links that extend the listing path
// (WordPress-style), so we sweep every page of a category, not just the first.
function discoverPaginationUrls(html: string, listingUrl: string, cap: number): string[] {
  const base = new URL(listingUrl);
  const basePath = base.pathname.replace(/\/page\/\d+\/?$/, "").replace(/\/+$/, "");
  const found = new Set<string>();
  for (const u of extractAnchorUrls(html, listingUrl)) {
    try {
      const p = new URL(u);
      if (p.origin !== base.origin) continue;
      const m = p.pathname.match(/^(.*?)\/page\/(\d+)\/?$/);
      if (!m) continue;
      if (m[1].replace(/\/+$/, "") !== basePath) continue;
      if (Number(m[2]) < 2) continue;
      found.add(`${p.origin}${p.pathname.replace(/\/+$/, "")}`);
    } catch {
      /* ignore */
    }
  }
  return Array.from(found).slice(0, cap);
}

export async function importEventsFromSiteUrl(opts: {
  // Single URL: scrape the page, look for event-detail links, fetch each.
  // Multi-URL: skip discovery, treat each URL as a detail page directly.
  // (Use multi-URL when the listing page is JS-rendered and our scraper
  // can't see the detail links in the raw HTML.)
  url?: string;
  urls?: string[];
  // Image mode: skip URL fetching entirely and let Claude read events out
  // of screenshots. Useful for sites that block server-side requests
  // (.gov.uk / Cloudflare-protected sites).
  imageUrls?: string[];
  // Optional explicit cap (admin override) — 0 = use MAX_DETAIL_PAGES default.
  maxPages?: number;
}): Promise<SiteImportResult> {
  const ctx = await requireAdmin();
  if (!ctx) return { error: "Admins only." };

  // ---- Image mode: AI vision over uploaded screenshots ----
  if (opts.imageUrls && opts.imageUrls.length > 0) {
    const sb = createServiceClient();
    const { data: genres } = await sb.from("genres").select("slug, name").order("name");
    const availableGenres = (genres ?? []).map((g) => ({ slug: g.slug, name: g.name }));
    const allowedLocation = await buildAllowedLocation(sb);

    // The screenshot itself isn't a per-event poster — multiple events share
    // it — so we don't try to assign it as posterImageUrl on each draft.
    let extraction;
    try {
      extraction = await extractEvents({
        venueName: "(unknown — please detect from screenshot)",
        postedAt: new Date().toISOString(),
        imageUrls: opts.imageUrls.slice(0, 8),
        availableCategories: availableGenres,
        locationFilter: allowedLocation,
      });
    } catch (e: any) {
      return { error: `AI extraction failed: ${e?.message ?? "unknown error"}` };
    }

    const rawDrafts: QuickDraft[] = extraction.events.map((e: ExtractedEvent) => ({
      title: e.title,
      starts_at: e.starts_at,
      ends_at: e.ends_at,
      description: e.description ?? "",
      genres: e.categories ?? [],
      artists: [],
      confidence: e.confidence,
      venue_hint: e.venue_hint,
      cover_charge: e.cover_charge,
      ticket_url: e.ticket_url,
      // No per-event poster — admin can replace via the row's image editor.
      posterImageUrl: "",
    }));
    const drafts = await applyArtistMatchesToDrafts(sb, rawDrafts);

    return {
      ok: true,
      indexUrl: "(screenshots)",
      pagesFetched: opts.imageUrls.length,
      pagesSkipped: 0,
      drafts,
      warnings: drafts.length === 0
        ? ["Couldn't pull any events out of the screenshot. Try a clearer image, or one screenshot per scroll-screen."]
        : [],
    };
  }

  // Normalise inputs. Accept either { url } or { urls } — multi-URL paths
  // go straight to per-page extraction without listing discovery.
  const rawList: string[] = [];
  if (opts.urls && opts.urls.length > 0) rawList.push(...opts.urls);
  else if (opts.url) rawList.push(opts.url);
  const cleaned = rawList
    .map((u) => u.trim())
    .filter((u) => u.length > 0);
  if (cleaned.length === 0) return { error: "Paste at least one URL or upload a screenshot." };

  // Validate all URLs up front
  const validatedUrls: string[] = [];
  for (const u of cleaned) {
    try {
      const p = new URL(u);
      if (p.protocol !== "http:" && p.protocol !== "https:") {
        return { error: `URL must be http(s): ${u}` };
      }
      validatedUrls.push(u);
    } catch {
      return { error: `Invalid URL: ${u}` };
    }
  }

  const sb = createServiceClient();
  const { data: genres } = await sb.from("genres").select("slug, name").order("name");
  const availableGenres = (genres ?? []).map((g) => ({ slug: g.slug, name: g.name }));
  const allowedLocation = await buildAllowedLocation(sb);
  const cap = Math.max(1, Math.min(50, opts.maxPages || MAX_DETAIL_PAGES));

  // ---- Unified sweep ----
  // Each pasted URL is auto-detected: a LISTING (we follow its detail links +
  // every page of pagination) or a single DETAIL page (extract it directly).
  // So you can paste several category feeds at once — e.g. the children-family,
  // music-dance and outdoors feeds — and it sweeps them all into one review.
  const LISTING_MIN_LINKS = 3; // >= this many detail links ⇒ it's a listing
  const detailSet = new Set<string>();
  const soloDetailPages: string[] = [];
  const warnings: string[] = [];
  let listingsSwept = 0;

  for (const inputUrl of validatedUrls) {
    const idx = await fetchRawHtml(inputUrl);
    if ("error" in idx) {
      warnings.push(`${inputUrl}: ${idx.error}`);
      continue;
    }
    const origin = new URL(idx.finalUrl).origin;
    const links = extractAnchorUrls(idx.html, idx.finalUrl, (u) => looksLikeEventDetail(u, origin));
    if (links.length >= LISTING_MIN_LINKS) {
      // A listing page — sweep it and every page of it (pagination is cheap, no AI).
      listingsSwept++;
      for (const l of links) detailSet.add(l);
      for (const pageUrl of discoverPaginationUrls(idx.html, idx.finalUrl, 10)) {
        const pg = await fetchRawHtml(pageUrl);
        if ("error" in pg) continue;
        for (const l of extractAnchorUrls(pg.html, pg.finalUrl, (u) => looksLikeEventDetail(u, origin))) {
          detailSet.add(l);
        }
      }
    } else {
      // Few/no detail links — treat the page itself as one detail page (the AI
      // reads any events listed inline). Covers JS-rendered / flattened pages.
      soloDetailPages.push(idx.finalUrl);
    }
  }

  const allDetailUrls = Array.from(new Set([...detailSet, ...soloDetailPages]));
  const totalFound = allDetailUrls.length;

  if (totalFound === 0) {
    return {
      ok: true,
      indexUrl: validatedUrls[0],
      pagesFetched: 0,
      pagesSkipped: 0,
      drafts: [],
      places: [],
      warnings: [...warnings, "No event or place pages found — check the URL points to a what's-on / listings page."],
    };
  }

  const pagesToFetch = allDetailUrls.slice(0, cap);

  // Fetch + extract each detail page concurrently (small pool to stay polite
  // and fit the function timeout). AI extraction is the dominant cost/time.
  const allDrafts: QuickDraft[] = [];
  const allPlaces: { place: ExtractedPlace; sourceUrl: string }[] = [];
  let fetched = 0;
  let skipped = 0;

  await pool(pagesToFetch, 4, async (pageUrl) => {
    const raw = await fetchRawHtml(pageUrl);
    if ("error" in raw) {
      skipped++;
      warnings.push(`${pageUrl}: ${raw.error}`);
      return;
    }
    fetched++;
    const page = htmlToScrapedPage(raw.html, raw.finalUrl);
    if (page.text.length < 60) {
      skipped++;
      return;
    }
    try {
      const { drafts, places } = await runExtraction(page.text, page.imageUrls, raw.finalUrl, availableGenres, allowedLocation);
      allDrafts.push(...drafts);
      for (const p of places) allPlaces.push({ place: p, sourceUrl: raw.finalUrl });
    } catch (e: any) {
      warnings.push(`${pageUrl}: ${e?.message ?? "extraction failed"}`);
    }
  });

  if (totalFound > cap) {
    warnings.push(`Found ${totalFound} listings across ${listingsSwept} feed(s) — imported the first ${cap}. Re-run (or raise the cap) to get the rest.`);
  }

  return {
    ok: true,
    indexUrl: validatedUrls[0],
    pagesFetched: fetched,
    pagesSkipped: skipped,
    drafts: await applyArtistMatchesToDrafts(sb, allDrafts),
    places: await toPlaceDrafts(sb, allPlaces),
    warnings,
  };
}

async function runExtraction(
  text: string,
  imageUrls: string[],
  pageUrl: string,
  availableGenres: { slug: string; name: string }[],
  locationFilter: { city: string; nearbyAreas: string[] },
): Promise<{ drafts: QuickDraft[]; places: ExtractedPlace[] }> {
  const extraction = await extractEvents({
    venueName: "(unknown — please detect from page)",
    postedAt: new Date().toISOString(),
    textContent: text,
    imageUrls: imageUrls.slice(0, 3), // cap images to keep AI cost down
    availableCategories: availableGenres,
    locationFilter,
    detectPlaces: true, // aggregator: classify ongoing attractions as places
  });
  const drafts = extraction.events.map((e: ExtractedEvent): QuickDraft => ({
    title: e.title,
    starts_at: e.starts_at,
    ends_at: e.ends_at,
    description: e.description ?? "",
    genres: e.categories ?? [],
    artists: [],
    confidence: e.confidence,
    venue_hint: e.venue_hint,
    cover_charge: e.cover_charge,
    // Prefer the AI-detected ticket URL; fall back to the source page URL
    // (admins can clear it if it's just the listing page rather than a real ticket page).
    ticket_url: e.ticket_url ?? pageUrl,
    posterImageUrl: imageUrls[0] ?? "",
  }));
  return { drafts, places: extraction.places };
}

// Tiny concurrency pool — borrowed from the FB cron pattern.
async function pool<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const idx = next++;
      if (idx >= items.length) return;
      await fn(items[idx]);
    }
  });
  await Promise.all(workers);
}
