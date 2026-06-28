"use server";

// Artist photo auto-fill from Facebook (or any URL really).
// Preview-then-confirm flow: admin clicks "Pull pic" → server fetches the
// page and parses og:image → returns the URL so the UI can show it next to
// the current image → admin clicks "Use this" or "Skip" to apply or discard.
//
// We never auto-apply because FB sometimes returns the wrong image (a
// generic FB logo, an old profile pic, an irrelevant cover photo). Admin
// approval makes sure we don't pollute the artists table.
//
// Bypasses RLS via the service client — admin-gated above.

import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { revalidatePath } from "next/cache";

async function requireAdmin() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: prof } = await supabase
    .from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (prof?.role !== "admin") return null;
  return { userId: user.id };
}

export type PreviewResult =
  | { ok: true; imageUrl: string; sourceUrl: string }
  | { error: string };

/**
 * Fetch the artist's source URL (Facebook page, website, anything) and
 * extract the og:image. Returns the URL but does NOT save it — caller
 * must apply via applyArtistImage().
 *
 * Best-effort: returns { error } if the page rejects us (FB sometimes
 * does), if there's no og:image, or if the URL is malformed.
 */
export async function previewArtistImage(artistId: string): Promise<PreviewResult> {
  const ctx = await requireAdmin();
  if (!ctx) return { error: "Admins only." };

  const sb = createServiceClient();
  const { data: artist } = await sb
    .from("artists")
    .select("id, name, facebook, website")
    .eq("id", artistId)
    .maybeSingle();
  if (!artist) return { error: "Artist not found." };

  // Prefer Facebook URL since that's what admin asked for, but fall through
  // to website if FB isn't set — admin gets the og:image either way.
  const src = (artist.facebook ?? artist.website ?? "").trim();
  if (!src) return { error: "Artist has no Facebook URL or website set." };

  let url: URL;
  try {
    url = new URL(src);
  } catch {
    return { error: `Invalid URL: ${src}` };
  }

  // FB serves *different* HTML to different user-agents. Pretending to be
  // a real browser doubles the success rate vs the default Node fetch UA.
  const browserUA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

  let html: string;
  try {
    const res = await fetch(url.toString(), {
      headers: {
        "User-Agent": browserUA,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-GB,en;q=0.9",
      },
      // 10s safety net — FB sometimes hangs
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      return { error: `Source returned ${res.status} — FB may be blocking us, or the page is private.` };
    }
    html = await res.text();
  } catch (e: any) {
    return { error: `Couldn't fetch source: ${e?.message ?? "unknown error"}` };
  }

  // Parse og:image. Try both attribute orders since some sites stick
  // content before property.
  const patterns = [
    /<meta[^>]+property=["']og:image(?::secure_url)?["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image(?::secure_url)?["']/i,
    /<meta[^>]+property=["']twitter:image["'][^>]+content=["']([^"']+)["']/i,
  ];

  let imageUrl: string | null = null;
  for (const p of patterns) {
    const m = html.match(p);
    if (m?.[1]) {
      imageUrl = m[1];
      break;
    }
  }

  if (!imageUrl) {
    return { error: "No og:image found on the page. FB may have served us a login wall, or this isn't a public page." };
  }

  // Resolve relative URLs against the source (rare for og:image but defensive)
  try {
    imageUrl = new URL(imageUrl, url.toString()).toString();
  } catch {
    return { error: `Extracted og:image is malformed: ${imageUrl}` };
  }

  return { ok: true, imageUrl, sourceUrl: url.toString() };
}

/**
 * Auto-search for an artist's Facebook page via DuckDuckGo's HTML
 * endpoint. Free, no API key, no rate limits to worry about at our scale.
 *
 * Returns up to 5 candidate facebook.com URLs ranked by DDG's own
 * relevance. Admin picks the right one (multiple "Andy Smith" pages
 * could match a band name like that) and clicks Save — same flow as
 * the manual paste-in path, just with the search step automated.
 *
 * Best-effort: if DDG is slow / blocks us / returns no FB results,
 * returns { ok: true, candidates: [] } so the UI can fall back to the
 * manual Google-search workflow.
 */
export type FindFbResult =
  | { ok: true; candidates: string[]; query: string }
  | { error: string };

export async function findArtistFacebookUrl(artistId: string): Promise<FindFbResult> {
  const ctx = await requireAdmin();
  if (!ctx) return { error: "Admins only." };

  const sb = createServiceClient();
  const { data: artist } = await sb
    .from("artists")
    .select("name, website")
    .eq("id", artistId)
    .maybeSingle();
  if (!artist?.name) return { error: "Artist not found." };

  const name = artist.name.trim();
  const allCandidates = new Set<string>();
  const errors: string[] = [];

  // STRATEGY 1: scrape the artist's own website for FB links. Best
  // signal-to-noise — when an artist explicitly links to a FB page
  // from their own site, that's almost always the right one.
  // Bypasses search-engine anti-bot defences entirely.
  if (artist.website?.trim()) {
    const { urls, error } = await scrapeFacebookLinksFromUrl(artist.website.trim());
    urls.forEach((u) => allCandidates.add(u));
    if (error) errors.push(`Website (${artist.website}): ${error}`);
  }

  // STRATEGY 2: search engines. Only run if the website scrape didn't
  // give us at least one solid candidate.
  const queries = [
    `"${name}" site:facebook.com`,           // exact phrase, FB only
    `"${name}" Scotland site:facebook.com`,  // UK bias — most Buzz artists are Scottish
    `${name} site:facebook.com`,              // any-word, FB only
    `"${name}" facebook`,                     // exact phrase, no site filter
    `${name} facebook page`,                  // hint phrase, no site filter
  ];

  // Wrap the search-engine block so we only run it when we still need
  // more candidates. If the website scrape already returned URLs, we
  // skip search engines entirely (avoids unnecessary requests + dodges
  // their anti-bot blocks).
  if (allCandidates.size < 3) {

    // Brave Search API first — proper paid API (free tier 2k/mo with no
    // credit card) so we never get 403'd. Only runs when admin has set
    // up the BRAVE_SEARCH_API_KEY env var; falls through to scraped
    // engines otherwise.
    const braveKey = process.env.BRAVE_SEARCH_API_KEY;
    if (braveKey) {
      for (const q of queries) {
        const { urls, error } = await searchBrave(q, braveKey);
        urls.forEach((u) => allCandidates.add(u));
        if (error) errors.push(`Brave: ${error}`);
        if (allCandidates.size >= 10) break;
      }
    }

    // Bing as second source — historically tolerant of scraped traffic
    // but anti-bot has tightened so it 403s sometimes too.
    if (allCandidates.size < 3) {
      for (const q of queries) {
        const { urls, error } = await searchBing(q);
        urls.forEach((u) => allCandidates.add(u));
        if (error) errors.push(`Bing: ${error}`);
        if (allCandidates.size >= 10) break;
      }
    }

    // DDG as third source. Wrapped so its 403s don't poison the result
    // if other sources already gave us decent candidates.
    if (allCandidates.size < 3) {
      for (const q of queries) {
        const { urls, error } = await searchDuckDuckGo(q);
        urls.forEach((u) => allCandidates.add(u));
        if (error) errors.push(`DDG: ${error}`);
        if (allCandidates.size >= 10) break;
      }
    }
  }

  if (allCandidates.size === 0) {
    // Tell admin WHY we found nothing. Three failure modes:
    //   - Artist has no website set AND search engines blocked us → blocked
    //   - Artist has a website but no FB link on it, search engines empty → no FB exists
    //   - Search engines just returned no results → no FB exists
    const blocked = errors.some((e) => /403|429|blocked|rate/i.test(e));
    if (blocked) {
      const detail = errors[0] ?? "";
      return { error: `Search engines blocked us — ${detail}. Use the manual paste field below.` };
    }
    return { ok: true, candidates: [], query: queries[0] };
  }

  // Rank by how closely the FB page path matches the artist name.
  // Bands with unique names should bubble straight to the top; common
  // names get whatever's most-relevant per the search engine plus the
  // string-similarity score.
  const ranked = rankFacebookCandidates(Array.from(allCandidates), name);

  return { ok: true, candidates: ranked.slice(0, 5), query: queries[0] };
}

const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

// A fuller set of browser-like headers — search engines fingerprint on
// these and reject Node fetch's spartan default set with a 403. Adding
// Accept-Language + Sec-Fetch-* takes us from "obvious bot" to "looks
// like a real Chrome/Safari".
const BROWSER_HEADERS: Record<string, string> = {
  "User-Agent": BROWSER_UA,
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "en-GB,en;q=0.9",
  "Cache-Control": "max-age=0",
  "Sec-Ch-Ua": '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
  "Sec-Ch-Ua-Mobile": "?0",
  "Sec-Ch-Ua-Platform": '"macOS"',
  "Sec-Fetch-Dest": "document",
  "Sec-Fetch-Mode": "navigate",
  "Sec-Fetch-Site": "none",
  "Sec-Fetch-User": "?1",
  "Upgrade-Insecure-Requests": "1",
};

// Filter out FB system URLs that aren't actual page profiles. These
// turn up a lot in search results and pollute the candidate list.
const JUNK_FB_PATH_RE = /^\/(login|signup|recover|policy|help|legal|terms|privacy|business|gaming|watch|share|photo|story|reel|public|people|groups|marketplace|events|posts|videos|notes|pages\/category|search|directory|find-friends|friends|messages|notifications|settings|home|feed|hashtag|ads)(\b|\/)/i;

type SearchOutcome = { urls: string[]; error?: string };

async function searchDuckDuckGo(query: string): Promise<SearchOutcome> {
  try {
    // Try the lite endpoint first — designed for low-bandwidth + less
    // aggressive anti-bot defences than html.duckduckgo.com. kl=uk-en
    // biases to UK results (same reason as Brave country=gb).
    const q = encodeURIComponent(query);
    const endpoints = [
      `https://lite.duckduckgo.com/lite/?q=${q}&kl=uk-en`,
      `https://html.duckduckgo.com/html/?q=${q}&kl=uk-en`,
    ];
    let html: string | null = null;
    let lastStatus = 0;
    for (const url of endpoints) {
      const res = await fetch(url, {
        headers: BROWSER_HEADERS,
        signal: AbortSignal.timeout(10_000),
      });
      lastStatus = res.status;
      if (res.ok) {
        html = await res.text();
        break;
      }
    }
    if (!html) {
      return { urls: [], error: `${lastStatus} from DuckDuckGo` };
    }

    const out = new Set<string>();
    // Try DDG redirect form first (html.duckduckgo.com)
    const redirectPattern = /href=["'][^"']*\/l\/\?[^"']*uddg=([^&"']+)/gi;
    let m: RegExpExecArray | null;
    while ((m = redirectPattern.exec(html)) !== null) {
      const cleaned = cleanFacebookUrl(safeDecodeURL(m[1]));
      if (cleaned) out.add(cleaned);
      if (out.size >= 10) break;
    }
    // Fall through to direct-URL pattern (lite.duckduckgo.com serves
    // facebook.com URLs without the redirect wrapper).
    if (out.size === 0) {
      const directPattern = /href=["'](https?:\/\/[^"']*facebook\.com[^"']*)["']/gi;
      while ((m = directPattern.exec(html)) !== null) {
        const cleaned = cleanFacebookUrl(m[1]);
        if (cleaned) out.add(cleaned);
        if (out.size >= 10) break;
      }
    }
    return { urls: Array.from(out) };
  } catch (e: any) {
    return { urls: [], error: e?.message ?? "fetch failed" };
  }
}

async function searchBrave(query: string, apiKey: string): Promise<SearchOutcome> {
  // Proper Search API — no anti-bot games. Free tier is 2k queries/mo
  // (1 query/sec). Sign up at https://brave.com/search/api/ and set
  // BRAVE_SEARCH_API_KEY in Vercel. Returns clean JSON.
  //
  // country=gb biases results to UK-based pages — without it Brave
  // defaults to US, which surfaces American bands with the same name
  // ahead of the Scottish artists we actually want. Same for Bing
  // (cc=gb) and DDG (kl=uk-en) below.
  try {
    const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=10&country=gb&search_lang=en&ui_lang=en-GB`;
    const res = await fetch(url, {
      headers: {
        Accept: "application/json",
        "Accept-Encoding": "gzip",
        "X-Subscription-Token": apiKey,
      },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      return { urls: [], error: `${res.status} from Brave Search` };
    }
    const json = await res.json();
    const results: any[] = json?.web?.results ?? [];
    const out = new Set<string>();
    for (const r of results) {
      const url = r?.url;
      if (typeof url !== "string") continue;
      const cleaned = cleanFacebookUrl(url);
      if (cleaned) out.add(cleaned);
      if (out.size >= 10) break;
    }
    return { urls: Array.from(out) };
  } catch (e: any) {
    return { urls: [], error: e?.message ?? "fetch failed" };
  }
}

async function searchBing(query: string): Promise<SearchOutcome> {
  try {
    // cc=GB + mkt=en-GB biases Bing to UK results (same reason as Brave's country=gb)
    const url = `https://www.bing.com/search?q=${encodeURIComponent(query)}&cc=GB&mkt=en-GB`;
    const res = await fetch(url, {
      headers: BROWSER_HEADERS,
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      return { urls: [], error: `${res.status} from Bing` };
    }
    const html = await res.text();
    const out = new Set<string>();
    // Bing inlines real URLs in href without a redirect wrapper.
    const linkPattern = /href=["'](https?:\/\/[^"']*facebook\.com[^"']*)["']/gi;
    let m: RegExpExecArray | null;
    while ((m = linkPattern.exec(html)) !== null) {
      const cleaned = cleanFacebookUrl(m[1]);
      if (cleaned) out.add(cleaned);
      if (out.size >= 10) break;
    }
    return { urls: Array.from(out) };
  } catch (e: any) {
    return { urls: [], error: e?.message ?? "fetch failed" };
  }
}

function safeDecodeURL(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

// Normalise + sanity-check a facebook URL. Returns null when it's a
// FB system URL we don't want as a candidate.
function cleanFacebookUrl(raw: string): string | null {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  const host = u.hostname.toLowerCase();
  if (!host.endsWith("facebook.com") && !host.endsWith("fb.com")) return null;
  u.search = "";
  u.hash = "";
  // m.facebook.com and l.facebook.com both serve the same page as www —
  // normalise so we don't dedupe the same target twice.
  if (host.startsWith("m.") || host.startsWith("l.") || host.startsWith("lm.")) {
    u.hostname = "www." + host.split(".").slice(1).join(".");
  }
  // Trim trailing slash for dedupe consistency
  const path = u.pathname.replace(/\/$/, "");
  u.pathname = path;
  // Drop FB system paths (login, watch, search etc.)
  if (JUNK_FB_PATH_RE.test(path + "/")) return null;
  // Empty path = facebook.com root
  if (path === "" || path === "/") return null;
  return u.toString();
}

// Normalise a string for fuzzy comparison: lowercase, strip non-alnum,
// drop "the" prefix + common band suffixes.
function normaliseForMatch(s: string): string {
  return s
    .toLowerCase()
    .replace(/^the\s+/, "")
    .replace(/\s+(band|music|official|page|live)$/, "")
    .replace(/[^a-z0-9]/g, "");
}

// Rank candidate FB URLs by how well their path matches the artist
// name. Exact normalised match → top. Substring containment → middle.
// Otherwise → unranked tail (preserves search engine order for them).
function rankFacebookCandidates(urls: string[], artistName: string): string[] {
  const target = normaliseForMatch(artistName);
  type Scored = { url: string; score: number; orig: number };
  const scored: Scored[] = urls.map((url, orig) => {
    let path = "";
    try {
      path = new URL(url).pathname.replace(/^\/+|\/+$/g, "");
    } catch {
      // shouldn't happen — already validated upstream
    }
    // FB profile.php?id=... has no useful path segment; use search-rank only
    const firstSeg = path.split("/")[0] ?? "";
    const norm = normaliseForMatch(firstSeg);
    let score = 0;
    if (norm.length === 0) {
      score = 0;
    } else if (norm === target) {
      score = 100;
    } else if (target.includes(norm) || norm.includes(target)) {
      score = 70;
    } else {
      // Character overlap: simple Jaccard-style metric
      const common = countCommonChars(norm, target);
      score = Math.round((common / Math.max(norm.length, target.length)) * 50);
    }
    return { url, score, orig };
  });
  // Higher score first; tie-break by original search-rank.
  scored.sort((a, b) => b.score - a.score || a.orig - b.orig);
  return scored.map((s) => s.url);
}

function countCommonChars(a: string, b: string): number {
  const aChars = a.split("");
  const bChars = new Map<string, number>();
  for (const c of b) bChars.set(c, (bChars.get(c) ?? 0) + 1);
  let n = 0;
  for (const c of aChars) {
    const v = bChars.get(c) ?? 0;
    if (v > 0) {
      n++;
      bChars.set(c, v - 1);
    }
  }
  return n;
}

/**
 * Save a Facebook URL onto an artist. Used by the "Need FB URL" panel:
 * admin Googles the artist's FB page, pastes the URL, we store it. The
 * artist then drops out of the "needs URL" list and becomes eligible
 * for the og:image puller.
 *
 * Light validation — must look like a facebook URL. Anything else (a
 * Google search result page, twitter etc.) gets rejected cleanly.
 */
export async function saveArtistFacebookUrl(
  artistId: string,
  rawUrl: string,
): Promise<{ ok: true } | { error: string }> {
  const ctx = await requireAdmin();
  if (!ctx) return { error: "Admins only." };

  const url = (rawUrl ?? "").trim();
  if (!url) return { error: "URL can't be empty." };

  // Normalise common shorthands — admin can paste "facebook.com/whoever"
  // without a protocol.
  const withProtocol = /^https?:\/\//i.test(url) ? url : `https://${url}`;

  let parsed: URL;
  try {
    parsed = new URL(withProtocol);
  } catch {
    return { error: `Doesn't look like a URL: ${url}` };
  }

  const host = parsed.hostname.toLowerCase();
  if (!/(^|\.)facebook\.com$/.test(host) && !/(^|\.)fb\.com$/.test(host)) {
    return { error: `That URL isn't a Facebook page — got ${host}.` };
  }

  const sb = createServiceClient();
  const { error } = await sb
    .from("artists")
    .update({ facebook: withProtocol })
    .eq("id", artistId);
  if (error) return { error: error.message };

  revalidatePath("/admin/artist-photos");
  return { ok: true };
}

/**
 * Apply a previewed image URL to the artist's image_url. Idempotent —
 * setting the same value twice is fine.
 */
export async function applyArtistImage(
  artistId: string,
  imageUrl: string,
): Promise<{ ok: true } | { error: string }> {
  const ctx = await requireAdmin();
  if (!ctx) return { error: "Admins only." };

  if (!imageUrl || !imageUrl.startsWith("http")) {
    return { error: "Invalid image URL." };
  }

  const sb = createServiceClient();
  const { error } = await sb
    .from("artists")
    .update({ image_url: imageUrl })
    .eq("id", artistId);
  if (error) return { error: error.message };

  // Bust caches on the public artist page + admin list
  const { data: artist } = await sb
    .from("artists")
    .select("slug")
    .eq("id", artistId)
    .maybeSingle();
  revalidatePath("/admin/artist-photos");
  revalidatePath("/admin/artists");
  if (artist?.slug) revalidatePath(`/artists/${artist.slug}`);
  return { ok: true };
}

/**
 * Fetch a non-FB URL (artist's own website) and extract any
 * facebook.com links from the HTML. High-signal: when an artist
 * explicitly links to a FB page from their own website, that's
 * almost certainly the right one.
 *
 * Bypasses search-engine anti-bot defences. Cleanest way to find FB
 * URLs given Bing + DDG both block us most of the time.
 */
async function scrapeFacebookLinksFromUrl(rawUrl: string): Promise<SearchOutcome> {
  let url: URL;
  try {
    // Tolerate URLs pasted without protocol
    const withProtocol = /^https?:\/\//i.test(rawUrl) ? rawUrl : `https://${rawUrl}`;
    url = new URL(withProtocol);
  } catch {
    return { urls: [], error: "invalid website URL" };
  }
  // Don't try to scrape FB itself — FB-on-FB scraping needs login
  const host = url.hostname.toLowerCase();
  if (host.endsWith("facebook.com") || host.endsWith("fb.com")) {
    return { urls: [], error: "website URL is already a Facebook URL" };
  }

  try {
    const res = await fetch(url.toString(), {
      headers: BROWSER_HEADERS,
      signal: AbortSignal.timeout(10_000),
      redirect: "follow",
    });
    if (!res.ok) {
      return { urls: [], error: `${res.status} from ${host}` };
    }
    const html = await res.text();
    const out = new Set<string>();
    // Look for any <a href> or social-meta tag pointing at facebook.com.
    // The cleanFacebookUrl filter strips junk paths (login, share etc.).
    const patterns = [
      /href=["'](https?:\/\/[^"']*facebook\.com[^"']*)["']/gi,
      /content=["'](https?:\/\/[^"']*facebook\.com[^"']*)["']/gi,
    ];
    for (const p of patterns) {
      let m: RegExpExecArray | null;
      while ((m = p.exec(html)) !== null) {
        const cleaned = cleanFacebookUrl(m[1]);
        if (cleaned) out.add(cleaned);
        if (out.size >= 10) break;
      }
      if (out.size >= 10) break;
    }
    return { urls: Array.from(out) };
  } catch (e: any) {
    return { urls: [], error: e?.message ?? "fetch failed" };
  }
}
