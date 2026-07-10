// Shared discovery helpers for the aggregator importer — used by both the
// manual /admin/import-site action and the scheduled cron. No DB, no AI.

import { fetchRawHtml, extractAnchorUrls } from "@/lib/scrape-website";

// Heuristics that pick out URLs that LOOK like individual event-detail pages
// rather than nav links, blog posts, category archives, pagination etc.
export function looksLikeEventDetail(linkUrl: URL, baseOrigin: string): boolean {
  if (linkUrl.origin !== baseOrigin) return false;
  const path = linkUrl.pathname.toLowerCase();

  if (
    /\.(jpg|jpeg|png|webp|gif|pdf|zip|mp3|mp4|css|js|svg|ico)$/.test(path) ||
    /^\/wp-(admin|content|json|login)/.test(path) ||
    /^\/(cart|checkout|account|my-account|basket|terms|privacy|contact|about|search|tag|category|author|feed|rss|comments|wp-)/i.test(path) ||
    // Category / archive listing pages and pagination are NOT event details.
    /-category\//.test(path) ||
    /\/page\/\d+\/?$/.test(path) ||
    /\/feed\/?$/.test(path) ||
    path === "/" ||
    path.length < 4
  ) return false;

  const positiveTokens = [
    "/event", "/events/", "/whats-on", "/gig", "/show", "/shows/",
    "/upcoming", "/listing", "/tickets/", "/gigs/", "/shop/event",
  ];
  return positiveTokens.some((tok) => path.includes(tok));
}

// Pagination discovery: find ".../page/N/" links that extend the listing path
// (WordPress-style), so a category with several pages is swept fully.
export function discoverPaginationUrls(html: string, listingUrl: string, cap: number): string[] {
  const base = new URL(listingUrl);
  const basePath = base.pathname.replace(/\/page\/\d+\/?$/, "").replace(/\/+$/, "");
  const found = new Set<string>();
  for (const u of extractAnchorUrls(html, listingUrl)) {
    try {
      const p = new URL(u);
      if (p.origin !== base.origin) continue;
      const m = p.pathname.match(/^(.*?)\/page\/(\d+)\/?$/);
      if (!m || Number(m[2]) < 2) continue;
      if (m[1].replace(/\/+$/, "") !== basePath) continue;
      found.add(`${p.origin}${p.pathname.replace(/\/+$/, "")}`);
    } catch {
      /* ignore */
    }
  }
  return Array.from(found).slice(0, cap);
}

// >= this many detail links on a page ⇒ treat it as a LISTING (sweep its links
// + pagination); fewer ⇒ treat the page itself as a single detail page.
const LISTING_MIN_LINKS = 3;

// Sweep one or more URLs into a deduped pool of event/place detail-page URLs.
// Each input is auto-detected as a listing or a single detail page.
export async function sweepListingUrls(
  urls: string[],
  opts: { paginationCap?: number } = {},
): Promise<{ detailUrls: string[]; listingsSwept: number; warnings: string[] }> {
  const paginationCap = opts.paginationCap ?? 10;
  const detailSet = new Set<string>();
  const soloPages: string[] = [];
  const warnings: string[] = [];
  let listingsSwept = 0;

  for (const inputUrl of urls) {
    const idx = await fetchRawHtml(inputUrl);
    if ("error" in idx) {
      warnings.push(`${inputUrl}: ${idx.error}`);
      continue;
    }
    const origin = new URL(idx.finalUrl).origin;
    const links = extractAnchorUrls(idx.html, idx.finalUrl, (u) => looksLikeEventDetail(u, origin));
    if (links.length >= LISTING_MIN_LINKS) {
      listingsSwept++;
      for (const l of links) detailSet.add(l);
      for (const pageUrl of discoverPaginationUrls(idx.html, idx.finalUrl, paginationCap)) {
        const pg = await fetchRawHtml(pageUrl);
        if ("error" in pg) continue;
        for (const l of extractAnchorUrls(pg.html, pg.finalUrl, (u) => looksLikeEventDetail(u, origin))) {
          detailSet.add(l);
        }
      }
    } else {
      soloPages.push(idx.finalUrl);
    }
  }

  return { detailUrls: Array.from(new Set([...detailSet, ...soloPages])), listingsSwept, warnings };
}
