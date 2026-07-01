// Tiny website scraper for venue sites. No login walls so plain HTTP is fine.
// Fetches the homepage + a small set of common event-related subpages,
// strips HTML to plain text, collects image URLs, returns a single payload
// the AI extractor can chew on.

const COMMON_EVENT_PATHS = [
  "/events",
  "/events/",
  "/whats-on",
  "/whats-on/",
  "/gigs",
  "/gigs/",
  "/live-music",
  "/live-music/",
  "/upcoming",
  "/upcoming-events",
  "/calendar",
  "/diary",
];

const SCRAPER_UA =
  "Mozilla/5.0 (compatible; TheBuzzBot/1.0; +https://www.thebuzzguide.co.uk/about)";

// Regional tourism directories / "visit X" portals. These are NEVER a single
// venue — their /whats-on lists an entire region's events. If a venue's website
// is one of these, scraping it dumps the whole region onto that one venue
// (that's how Beltane Fire Festival & the Tattoo ended up "at Cramond Beach").
// Skip them entirely.
const DIRECTORY_HOSTS = [
  "visitscotland.com",
  "welcometofife.com",
  "visitangus.com",
  "visiteastlothian.org",
  "visitdunbartonshire.com",
  "visitlanarkshire.com",
  "ayrshirescotland.com",
  "visitayrshirearran.com",
  "visitaberdeenshire.com",
  "visitcairngorms.com",
  "visitinvernesslochness.com",
  "visitscottishborders.com",
  "daysoutwithkids.co.uk",
  "list.co.uk",
  "eventbrite.co.uk",
];

function isDirectoryHost(host: string): boolean {
  const h = host.replace(/^www\./, "").toLowerCase();
  return DIRECTORY_HOSTS.some((d) => h === d || h.endsWith("." + d));
}

export type ScrapedPage = {
  url: string;
  title: string;
  text: string;
  imageUrls: string[];
  // Each content image paired with the text around it (alt + nearby card text),
  // so a listing page's events can be matched to their OWN poster by title
  // rather than all sharing the top banner.
  imageContexts?: { url: string; text: string }[];
  fetchedAt: string;
  socials: SocialLinks;
};

export type SocialLinks = {
  facebook?: string;
  instagram?: string;
  twitter?: string;
  tiktok?: string;
  youtube?: string;
  spotify?: string;
};

export type WebsiteScrapeResult = {
  pages: ScrapedPage[];
  errors: string[];
  socials: SocialLinks; // merged across all pages
};

export async function scrapeVenueWebsite(websiteUrl: string): Promise<WebsiteScrapeResult> {
  let origin: string;
  let parsed: URL;
  try {
    parsed = new URL(websiteUrl);
    origin = parsed.origin;
  } catch {
    return { pages: [], errors: [`Invalid URL: ${websiteUrl}`], socials: {} };
  }

  // Never scrape a regional tourism directory as if it were one venue.
  if (isDirectoryHost(parsed.hostname)) {
    return {
      pages: [],
      errors: [`skipped: ${parsed.hostname} is a regional directory, not a single venue`],
      socials: {},
    };
  }

  const candidates = new Set<string>();
  candidates.add(websiteUrl);

  // How deep is the venue's own URL? A root/shallow site (path "/" or one
  // segment) is a standalone venue — safe to probe origin-level /whats-on etc.
  // A DEEP path (e.g. glasgowlife.org.uk/museums/venues/kelvingrove) is a single
  // venue's page on a shared council/operator platform: probing the origin root
  // would grab the whole city's listings and dump them on this one venue. So we
  // only look for event pages *underneath the venue's own path* in that case.
  const segments = parsed.pathname.replace(/\/+$/, "").split("/").filter(Boolean);
  if (segments.length <= 1) {
    for (const path of COMMON_EVENT_PATHS) {
      try {
        candidates.add(new URL(path, origin).toString());
      } catch {
        /* ignore */
      }
    }
  } else {
    const base = `${origin}${parsed.pathname.replace(/\/+$/, "")}`;
    for (const sub of ["/events", "/whats-on", "/calendar", "/diary"]) {
      candidates.add(base + sub);
    }
  }

  const pages: ScrapedPage[] = [];
  const errors: string[] = [];
  const mergedSocials: SocialLinks = {};

  // 1. Fetch each candidate (sequentially, to be polite)
  for (const url of candidates) {
    try {
      const page = await fetchPage(url);
      // Even short / non-event pages might have a footer with socials, so capture
      // the social links before deciding whether to keep the page text.
      mergeSocials(mergedSocials, page.socials);
      // Skip if the page has basically no text — probably a 404 page or empty.
      if (page.text.length < 80) continue;
      pages.push(page);
    } catch (e: any) {
      const msg = e?.message ?? String(e);
      // Don't error for 404s on subpages — just means they don't exist
      if (!/^404|Not Found/.test(msg)) {
        errors.push(`${url}: ${msg}`);
      }
    }
  }

  // 2. Try to find more event pages by parsing homepage links
  const homepage = pages[0];
  if (homepage) {
    const linkPaths = findEventLinks(homepage.text, origin);
    for (const url of linkPaths) {
      if (pages.some((p) => p.url === url)) continue;
      try {
        const page = await fetchPage(url);
        if (page.text.length >= 80) pages.push(page);
      } catch {
        /* ignore */
      }
      if (pages.length >= 8) break; // cap total pages
    }
  }

  return { pages, errors, socials: mergedSocials };
}

// Public version of fetchPage for use by other scrapers (e.g. multi-venue promoter sites).
export async function fetchPagePublic(url: string): Promise<ScrapedPage> {
  return fetchPage(url);
}

// Real browser UA used as a fallback when our identified bot UA is blocked.
// Many sites (Cloudflare-protected, anti-scraping plugins, etc.) reject the
// TheBuzzBot UA but accept a normal-looking Chrome request.
const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

async function tryFetch(url: string, ua: string, timeoutMs: number): Promise<{ res: Response; ms: number } | { errorStatus: number | null; errorMessage: string }> {
  const start = Date.now();
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": ua,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-GB,en;q=0.9",
      },
      signal: controller.signal,
      redirect: "follow",
    });
    return { res, ms: Date.now() - start };
  } catch (e: any) {
    if (e?.name === "AbortError") {
      return { errorStatus: null, errorMessage: "timeout" };
    }
    // Surface as much info as we can — Node's undici stashes the underlying
    // network error in `cause`. Common codes: ENOTFOUND, ECONNREFUSED,
    // ECONNRESET, EAI_AGAIN, UND_ERR_SOCKET, ETIMEDOUT, CERT_HAS_EXPIRED.
    const cause = e?.cause;
    const code = cause?.code || e?.code;
    const causeMsg = cause?.message;
    const baseMsg = e?.message ?? "fetch failed";
    let msg = baseMsg;
    if (code) msg = `${baseMsg} (${code})`;
    else if (causeMsg && causeMsg !== baseMsg) msg = `${baseMsg}: ${causeMsg}`;
    // Heuristic: if no UA-specific detail, probably the host blocks our network.
    if (msg === "fetch failed") {
      msg = "fetch failed — the host likely blocks server-side requests (common on government / Cloudflare-protected sites)";
    }
    return { errorStatus: null, errorMessage: msg };
  } finally {
    clearTimeout(t);
  }
}

// Fetch raw HTML for a URL — used when we need to inspect links/structure
// before stripping tags. Tries the bot UA first, falls back to a Chrome UA
// if the bot UA gets blocked (403 / 401 / 429 / network rejection).
export async function fetchRawHtml(url: string): Promise<{ html: string; finalUrl: string } | { error: string }> {
  // Try bot UA first
  let attempt = await tryFetch(url, SCRAPER_UA, 20_000);
  let lastErr = "";
  if ("res" in attempt) {
    if (attempt.res.ok) {
      const ct = attempt.res.headers.get("content-type") ?? "";
      if (ct.includes("html") || ct.includes("text") || ct === "") {
        const html = await attempt.res.text();
        return { html, finalUrl: attempt.res.url || url };
      }
      lastErr = `non-HTML content-type (${ct})`;
    } else if (![403, 401, 429, 503].includes(attempt.res.status)) {
      // Real failure (404, 500, etc.) — no point retrying with a different UA
      return { error: `HTTP ${attempt.res.status} ${attempt.res.statusText}` };
    } else {
      lastErr = `bot UA blocked (HTTP ${attempt.res.status})`;
    }
  } else {
    lastErr = attempt.errorMessage;
  }

  // Fallback: Chrome UA
  attempt = await tryFetch(url, BROWSER_UA, 25_000);
  if ("res" in attempt) {
    if (attempt.res.ok) {
      const ct = attempt.res.headers.get("content-type") ?? "";
      if (ct.includes("html") || ct.includes("text") || ct === "") {
        const html = await attempt.res.text();
        return { html, finalUrl: attempt.res.url || url };
      }
      return { error: `Non-HTML response (${ct})` };
    }
    return { error: `HTTP ${attempt.res.status} ${attempt.res.statusText} (also tried bot UA: ${lastErr})` };
  }
  return { error: `${attempt.errorMessage} (also tried bot UA: ${lastErr})` };
}

// Pull anchor `href` URLs out of raw HTML, resolved against baseUrl, deduped.
// Optional `match` predicate filters to only relevant links (e.g. event-detail patterns).
export function extractAnchorUrls(
  html: string,
  baseUrl: string,
  match?: (url: URL) => boolean,
): string[] {
  const urls = new Set<string>();
  for (const m of html.matchAll(/<a[^>]+href=["']([^"'#]+)["']/gi)) {
    try {
      const abs = new URL(m[1], baseUrl);
      if (abs.protocol !== "http:" && abs.protocol !== "https:") continue;
      if (match && !match(abs)) continue;
      // Strip query strings & trailing slashes for dedupe consistency
      const clean = `${abs.origin}${abs.pathname.replace(/\/+$/, "")}`;
      urls.add(clean);
    } catch {
      /* ignore */
    }
  }
  return Array.from(urls);
}

// Convenience: pull plain text + images out of an already-fetched HTML string.
export function htmlToScrapedPage(html: string, url: string): { text: string; imageUrls: string[]; title: string } {
  return {
    text: htmlToText(html).slice(0, 12_000),
    imageUrls: extractImageUrls(html, url),
    title: extractTitle(html),
  };
}

async function fetchPage(url: string): Promise<ScrapedPage> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  let res: Response;
  try {
    res = await fetch(url, {
      headers: {
        "User-Agent": SCRAPER_UA,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
      signal: controller.signal,
      redirect: "follow",
    });
  } finally {
    clearTimeout(timeout);
  }

  if (!res.ok) {
    throw new Error(`${res.status} ${res.statusText}`);
  }
  const ct = res.headers.get("content-type") ?? "";
  if (!ct.includes("html") && !ct.includes("text")) {
    throw new Error(`Non-HTML response (${ct})`);
  }

  const html = await res.text();
  const title = extractTitle(html);
  // Extract socials BEFORE we strip the HTML
  const socials = extractSocialLinks(html);
  const text = htmlToText(html);
  const imageUrls = extractImageUrls(html, url);
  const imageContexts = extractImageContexts(html, url);

  return {
    url: res.url || url,
    title,
    text: text.slice(0, 12_000), // cap per page so we don't blow the AI's context
    imageUrls,
    imageContexts,
    fetchedAt: new Date().toISOString(),
    socials,
  };
}

// Pull each content image out WITH the text around it (its alt plus a window of
// nearby markup stripped to text — on a card listing that's the event title +
// blurb sitting next to the image). Lets the ingester match each event to its
// own poster instead of giving them all the page's top banner.
export function extractImageContexts(html: string, baseUrl: string): { url: string; text: string }[] {
  const SKIP = /(logo|icon|sprite|favicon|avatar|placeholder|header[-_/]?bg|footer[-_/]?bg|menu|nav[-_/]?bg|emoji)/i;
  const out: { url: string; text: string }[] = [];
  const seen = new Set<string>();
  const imgRe = /<img\b[^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = imgRe.exec(html)) !== null) {
    const tag = m[0];
    // Prefer a real lazy-loaded source over a placeholder src.
    const srcM =
      /\bdata-src=["']([^"']+)["']/i.exec(tag) ||
      /\bdata-lazy-src=["']([^"']+)["']/i.exec(tag) ||
      /\bsrc=["']([^"']+)["']/i.exec(tag);
    if (!srcM) continue;
    let url: string;
    try {
      url = new URL(srcM[1], baseUrl).toString();
    } catch {
      continue;
    }
    if (!/\.(jpg|jpeg|png|webp|gif)(\?|$)/i.test(url)) continue;
    if (SKIP.test(url)) continue;
    if (seen.has(url)) continue;
    seen.add(url);
    const altM = /\balt=["']([^"']*)["']/i.exec(tag);
    const alt = altM ? altM[1] : "";
    // Window of markup around the image → the card's title/blurb usually lives
    // right after (sometimes just before) the <img>.
    const from = Math.max(0, m.index - 220);
    const window = html.slice(from, m.index + 600).replace(/<[^>]+>/g, " ");
    const text = decodeEntities(`${alt} ${window}`).replace(/\s+/g, " ").trim().slice(0, 240);
    out.push({ url, text });
    if (out.length >= 60) break;
  }
  return out;
}

const SOCIAL_PATTERNS: Array<{ key: keyof SocialLinks; pattern: RegExp; reject?: RegExp }> = [
  { key: "facebook", pattern: /https?:\/\/(?:www\.|m\.|web\.)?facebook\.com\/[^\s"'<>]+/gi, reject: /\/(sharer|share|dialog|tr|plugins|events|search|reel|story|watch|pages\/category|profile\.php)\b/i },
  { key: "instagram", pattern: /https?:\/\/(?:www\.)?instagram\.com\/[^\s"'<>]+/gi, reject: /\/(p|reel|tv|explore|accounts|sharer)\b/i },
  { key: "twitter", pattern: /https?:\/\/(?:www\.)?(?:twitter|x)\.com\/[^\s"'<>]+/gi, reject: /\/(intent|share|search|hashtag|i\/)\b/i },
  { key: "tiktok", pattern: /https?:\/\/(?:www\.)?tiktok\.com\/@[^\s"'<>]+/gi },
  { key: "youtube", pattern: /https?:\/\/(?:www\.)?youtube\.com\/(?:c\/|channel\/|@|user\/)[^\s"'<>]+/gi },
  { key: "spotify", pattern: /https?:\/\/open\.spotify\.com\/(?:artist|user|playlist)\/[^\s"'<>]+/gi },
];

function extractSocialLinks(html: string): SocialLinks {
  const found: SocialLinks = {};
  for (const { key, pattern, reject } of SOCIAL_PATTERNS) {
    if (found[key]) continue;
    const matches = html.match(pattern);
    if (!matches) continue;
    for (const raw of matches) {
      // Trim trailing punctuation that often follows URLs in text (",", ")", ".")
      const url = raw.replace(/[)>,.;'"\\]+$/g, "").split("?")[0].replace(/\/$/, "");
      if (reject && reject.test(url)) continue;
      // Skip the bare domain — we want the actual page/profile URL
      if (/^https?:\/\/(?:www\.|m\.|web\.)?[^\/]+\/?$/.test(url)) continue;
      found[key] = url;
      break;
    }
  }
  return found;
}

function mergeSocials(target: SocialLinks, src: SocialLinks) {
  for (const k of Object.keys(src) as (keyof SocialLinks)[]) {
    if (!target[k] && src[k]) target[k] = src[k];
  }
}

function extractTitle(html: string): string {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return m ? decodeEntities(m[1].trim()).slice(0, 200) : "";
}

function htmlToText(html: string): string {
  let s = html
    // Drop scripts, styles, navs, footers — they're noise for event extraction
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[^>]*>[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, " ")
    .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, " ")
    .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, " ")
    .replace(/<svg[^>]*>[\s\S]*?<\/svg>/gi, " ")
    // Then strip remaining tags
    .replace(/<[^>]+>/g, " ");
  s = decodeEntities(s);
  return s.replace(/\s+/g, " ").trim();
}

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

function extractImageUrls(html: string, baseUrl: string): string[] {
  const ordered: string[] = [];
  const seen = new Set<string>();
  const push = (raw: string) => {
    try {
      const abs = new URL(raw, baseUrl).toString();
      if (seen.has(abs)) return;
      seen.add(abs);
      ordered.push(abs);
    } catch {
      /* ignore */
    }
  };

  // 1. og:image — canonical "this page is about this image" signal. By far
  // the most reliable source for the event poster on a detail page.
  for (const m of html.matchAll(
    /<meta[^>]+property=["']og:image(?::secure_url)?["'][^>]+content=["']([^"']+)["']/gi,
  )) push(m[1]);
  for (const m of html.matchAll(
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image(?::secure_url)?["']/gi,
  )) push(m[1]);

  // 2. twitter:image — fallback when og:image is missing
  for (const m of html.matchAll(
    /<meta[^>]+name=["']twitter:image(?::src)?["'][^>]+content=["']([^"']+)["']/gi,
  )) push(m[1]);

  // 3. <link rel="image_src">
  for (const m of html.matchAll(
    /<link[^>]+rel=["']image_src["'][^>]+href=["']([^"']+)["']/gi,
  )) push(m[1]);

  // 4. WordPress-style featured image hints (wp-post-image class)
  for (const m of html.matchAll(/<img[^>]+class=["'][^"']*wp-post-image[^"']*["'][^>]+src=["']([^"']+)["']/gi)) {
    if (/\.(jpg|jpeg|png|webp|gif)(\?|$)/i.test(m[1])) push(m[1]);
  }

  // 5. Other <img src="..."> — skip ones that look like UI chrome (logos, icons,
  // avatars, sprites, header / footer / nav graphics) so we don't pollute the
  // AI's input or grab the wrong fallback poster.
  const SKIP = /(logo|icon|sprite|favicon|avatar|placeholder|header[-_/]?bg|footer[-_/]?bg|menu|nav[-_/]?bg|emoji)/i;
  for (const m of html.matchAll(/<img[^>]+src=["']([^"']+)["']/gi)) {
    const src = m[1];
    if (!/\.(jpg|jpeg|png|webp|gif)(\?|$)/i.test(src)) continue;
    if (SKIP.test(src)) continue;
    push(src);
  }

  return ordered.slice(0, 6);
}

function findEventLinks(homepageText: string, _origin: string): string[] {
  // We strip HTML before this, so we don't have href attrs anymore — but we can
  // re-fetch the raw HTML if we want. Cheaper: just lean on COMMON_EVENT_PATHS
  // for now and skip dynamic discovery. Returning [] keeps the implementation
  // simple and predictable. (Stub kept here for future use.)
  return [];
}
