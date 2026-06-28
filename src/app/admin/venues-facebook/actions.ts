"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { fetchRawHtml } from "@/lib/scrape-website";

/**
 * Save (or clear) the Facebook URL for a single venue.
 * Admin-only.
 */
export async function saveVenueFacebook(venueId: string, raw: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };

  const { data: me } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();
  if (me?.role !== "admin") return { error: "Admins only." };

  const trimmed = (raw ?? "").trim();
  const value = trimmed.length === 0 ? null : trimmed;

  const { error } = await supabase
    .from("venues")
    .update({ facebook: value })
    .eq("id", venueId);
  if (error) return { error: error.message };

  revalidatePath("/admin/venues-facebook");
  return { ok: true, value };
}

const FB_PATTERN = /https?:\/\/(?:www\.|m\.|web\.)?facebook\.com\/[^\s"'<>&]+/gi;
const FB_REJECT = /\/(sharer|share|dialog|tr|plugins|events\/|search\/|reel|story|watch|pages\/category|profile\.php)\b/i;

function cleanFbCandidates(matches: string[]): string[] {
  const cleaned = new Set<string>();
  for (const raw of matches) {
    const url = raw
      .replace(/[)>,.;'"\\]+$/g, "")
      .split("?")[0]
      .replace(/\/$/, "");
    if (FB_REJECT.test(url)) continue;
    // Skip the bare facebook.com domain without a page handle.
    if (/^https?:\/\/(?:www\.|m\.|web\.)?[^\/]+\/?$/.test(url)) continue;
    cleaned.add(url);
  }
  return Array.from(cleaned);
}

async function findOnVenueWebsite(websiteUrl: string): Promise<string | null> {
  let url = websiteUrl.trim();
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
  const fetched = await fetchRawHtml(url);
  if ("error" in fetched) return null;
  const matches = fetched.html.match(FB_PATTERN) ?? [];
  const candidates = cleanFbCandidates(matches);
  return candidates[0] ?? null;
}

/**
 * Apify Google Search Scraper fallback. Hits Google directly via Apify's
 * managed actor — much better hit rate than DDG for small businesses.
 * Costs roughly $0.005 per query (5 USD per 1000), billed against the
 * APIFY_TOKEN already in use elsewhere in the app.
 *
 * Returns up to 5 cleaned facebook.com candidates.
 */
async function searchFacebookViaApifyGoogle(query: string): Promise<string[]> {
  const token = process.env.APIFY_TOKEN;
  if (!token) return [];

  const actor = "apify~google-search-scraper";
  const endpoint = `https://api.apify.com/v2/acts/${actor}/run-sync-get-dataset-items?token=${encodeURIComponent(token)}`;
  const body = {
    queries: query,
    resultsPerPage: 10,
    maxPagesPerQuery: 1,
    // ISO 3166-1 alpha-2 — "gb" not "uk" (Apify rejects "uk").
    countryCode: "gb",
    languageCode: "en",
    saveHtml: false,
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  let items: any[] = [];
  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) return [];
    items = await res.json();
  } catch {
    return [];
  } finally {
    clearTimeout(timeout);
  }

  const raws: string[] = [];
  for (const item of items) {
    const organic = (item?.organicResults ?? item?.results ?? []) as any[];
    for (const r of organic) {
      const url = typeof r?.url === "string" ? r.url : "";
      if (url.includes("facebook.com/")) raws.push(url);
    }
  }
  return cleanFbCandidates(raws).slice(0, 5);
}

/**
 * Search the web for a Facebook page matching the venue. We use DuckDuckGo's
 * HTML endpoint (no API key, no JS) and parse facebook.com links out of the
 * result page. Returns up to 5 candidate URLs.
 *
 * DDG often wraps result links in a /l/?uddg=... redirect, so we look for
 * both raw facebook.com URLs and the encoded redirect form.
 */
async function searchFacebookViaDDG(query: string): Promise<string[]> {
  const endpoint = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
  let html = "";
  try {
    const res = await fetch(endpoint, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-GB,en;q=0.9",
      },
      signal: controller.signal,
      redirect: "follow",
    });
    if (!res.ok) return [];
    html = await res.text();
  } catch {
    return [];
  } finally {
    clearTimeout(timeout);
  }

  const raws: string[] = [];
  // Direct facebook.com URLs that appear in the HTML.
  raws.push(...(html.match(FB_PATTERN) ?? []));
  // DDG redirect form: /l/?uddg=https%3A%2F%2Fwww.facebook.com%2F...
  for (const m of html.matchAll(/uddg=([^&"'\s>]+)/gi)) {
    try {
      const decoded = decodeURIComponent(m[1]);
      if (decoded.includes("facebook.com/")) raws.push(decoded);
    } catch {
      /* skip */
    }
  }
  return cleanFbCandidates(raws).slice(0, 5);
}

/**
 * Find a candidate Facebook URL for a venue, but DON'T save it. Caller (the
 * editor UI) reviews the candidate and approves it via saveVenueFacebook.
 *
 * Strategy: scrape the venue's own website footer first (most reliable);
 * if that turns up nothing, fall back to a `site:facebook.com Name City`
 * web search via DuckDuckGo. Either way returns a single best guess.
 *
 * Returns:
 *   { ok: true, value: string | null, source: "website" | "search" | null }
 */
export async function findFacebookCandidate(venueId: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };

  const { data: me } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();
  if (me?.role !== "admin") return { error: "Admins only." };

  const { data: venue } = await supabase
    .from("venues")
    .select("id, name, website, facebook, city:cities(name)")
    .eq("id", venueId)
    .maybeSingle();
  if (!venue) return { error: "Venue not found." };

  // 1. Try the venue's own website first — highest signal.
  if (venue.website) {
    try {
      const fromSite = await findOnVenueWebsite(venue.website);
      if (fromSite) {
        return { ok: true, value: fromSite, source: "website" as const };
      }
    } catch {
      /* fall through to web search */
    }
  }

  // 2. Free web search fallback (DuckDuckGo).
  const cityName = (venue.city as any)?.name ?? "";
  const query = `site:facebook.com ${venue.name}${cityName ? ` ${cityName}` : ""}`;
  try {
    const candidates = await searchFacebookViaDDG(query);
    if (candidates[0]) {
      return { ok: true, value: candidates[0], source: "search" as const };
    }
  } catch {
    /* fall through to Google */
  }

  // 3. Paid Google fallback via Apify (~$0.005 / query). Better hit rate
  // for small businesses that DDG misses.
  try {
    const candidates = await searchFacebookViaApifyGoogle(query);
    if (candidates[0]) {
      return { ok: true, value: candidates[0], source: "google" as const };
    }
  } catch {
    /* fall through to nothing-found */
  }

  return { ok: true, value: null, source: null };
}

/**
 * Hard-delete a venue from this admin page. Cleans up FK references that
 * don't cascade (events, claims, junction rows) so the delete doesn't
 * fail with a constraint violation. Admin-only.
 */
export async function deleteVenueFromAdmin(venueId: string): Promise<
  { ok: true } | { error: string }
> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };

  const { data: me } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();
  if (me?.role !== "admin") return { error: "Admins only." };

  // Use service client so RLS doesn't block the cleanup writes.
  const sb = createServiceClient();

  // Collect event ids so we can clean their junction rows first.
  const { data: eventRows } = await sb
    .from("events")
    .select("id")
    .eq("venue_id", venueId);
  const eventIds = (eventRows ?? []).map((e) => e.id);

  if (eventIds.length > 0) {
    // Best-effort cleanup of join tables. Each may or may not exist /
    // cascade in this schema; ignoring errors keeps the venue delete
    // from being blocked by an unrelated FK we don't even use.
    await sb.from("event_genres").delete().in("event_id", eventIds);
    await sb.from("event_artists").delete().in("event_id", eventIds);
    await sb.from("event_organisers").delete().in("event_id", eventIds);
    await sb.from("events").delete().in("id", eventIds);
  }

  // Venue-level dependents
  await sb.from("venue_claims").delete().eq("venue_id", venueId);
  await sb.from("festival_venues").delete().eq("venue_id", venueId);
  await sb.from("extraction_batches").delete().eq("venue_id", venueId);

  const { error } = await sb.from("venues").delete().eq("id", venueId);
  if (error) return { error: error.message };

  revalidatePath("/admin/venues-facebook");
  revalidatePath("/admin");
  return { ok: true };
}
