"use server";

// Backfill venue photos + opening hours from Google (via Apify
// compass~crawler-google-places, the same actor /admin/discover-venues
// already uses).
//
// The actor returns imageUrls[] and openingHours[] alongside the basic
// place data we already capture. We just throw those fields away in
// discover-venues — this tool surfaces them and writes them onto
// existing venue rows.
//
// Why chunked: one Apify run is ~10-30s per venue. We process 3 in
// parallel per batch to stay well under the page's maxDuration while
// still finishing 30 venues in ~5 minutes.

import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { revalidatePath } from "next/cache";

const APIFY_API = "https://api.apify.com/v2";
const APIFY_GMAPS_ACTOR = "compass~crawler-google-places";

// Per-run deadline. Most lookups finish in 10-20s; this is the hard
// ceiling before we abort to stop billing.
const APIFY_DEADLINE_MS = 45_000;

// Max photos we'll capture per venue. Six is the sweet spot — enough
// for a gallery, few enough that the venue page doesn't get image-heavy.
const MAX_PHOTOS = 6;

async function requireAdmin() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: prof } = await supabase
    .from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (prof?.role !== "admin") return null;
  return { userId: user.id };
}

// Normalised opening hours, keyed by short day name to match the
// existing opening_hours_json shape that effectiveEndTime() already
// reads from in lib/utils.ts.
type DayKey = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";
type DayEntry = { closed?: boolean; open?: string; close?: string };
export type OpeningHoursJson = Record<DayKey, DayEntry>;

export type VenueNeedingScan = {
  id: string;
  name: string;
  slug: string;
  citySlug: string | null;
  cityName: string | null;
  town: string | null;
  postcode: string | null;
  hasPhotos: boolean;
  hasHours: boolean;
};

export type ScanResult = {
  venueId: string;
  ok: boolean;
  // Reason we couldn't grab data — shown in the UI so admin knows why
  // a venue stayed empty.
  reason?: string;
  // Photo URLs Google returned (Google's CDN, lh3.googleusercontent.com).
  // We capture all of them and let admin tick which to keep up to 6.
  photos: string[];
  openingHoursJson: OpeningHoursJson | null;
  // Also return the human-readable hours string so admin can sanity-check
  // the parser's interpretation against what Google actually said.
  openingHoursText: string | null;
  googleMapsUrl: string | null;
};

// -----------------------------------------------------------
// PHASE 1: list venues missing data so admin can pick a batch.
// -----------------------------------------------------------

export async function listVenuesNeedingPhotosHours(opts: {
  citySlug?: string | null;
  // If true, include venues that have EITHER photos or hours but not
  // both. Default true — we want to fill in gaps, not just empty rows.
  includePartial?: boolean;
} = {}): Promise<
  { error: string } | { ok: true; venues: VenueNeedingScan[] }
> {
  const ctx = await requireAdmin();
  if (!ctx) return { error: "Admins only." };

  const sb = createServiceClient();
  let q = sb
    .from("venues")
    .select(
      "id, name, slug, postcode, address, gallery_image_urls, opening_hours_json, " +
        "city:cities ( slug, name )",
    )
    .order("name");

  if (opts.citySlug) {
    // Filter by city via a sub-select. We can't .eq on the joined
    // column directly in PostgREST, so resolve the id first.
    const { data: city } = await sb
      .from("cities").select("id").eq("slug", opts.citySlug).maybeSingle();
    if (!city) return { error: `City "${opts.citySlug}" not found.` };
    q = q.eq("city_id", city.id);
  }

  const { data, error } = await q;
  if (error) return { error: error.message };

  const includePartial = opts.includePartial ?? true;

  const venues: VenueNeedingScan[] = (data ?? [])
    .map((v: any) => {
      const hasPhotos = Array.isArray(v.gallery_image_urls) && v.gallery_image_urls.length > 0;
      const hasHours = v.opening_hours_json != null && typeof v.opening_hours_json === "object";
      // Derive a town hint from the address — the part before the
      // postcode. Helps the Apify search land on the right place.
      const addr: string = typeof v.address === "string" ? v.address : "";
      const town = addr.split(",").map((s) => s.trim()).find((s) => s.length > 0) ?? null;
      return {
        id: v.id,
        name: v.name,
        slug: v.slug,
        citySlug: v.city?.slug ?? null,
        cityName: v.city?.name ?? null,
        town,
        postcode: v.postcode,
        hasPhotos,
        hasHours,
      };
    })
    .filter((v) => {
      if (includePartial) return !v.hasPhotos || !v.hasHours;
      return !v.hasPhotos && !v.hasHours;
    });

  return { ok: true, venues };
}

// -----------------------------------------------------------
// PHASE 2: run Apify Google Places for one venue.
// -----------------------------------------------------------

async function scanOneVenue(
  venue: VenueNeedingScan,
  token: string,
): Promise<ScanResult> {
  // The most specific search we can build. Including the postcode (if we
  // have it) makes the wrong-result rate near-zero — Google's index is
  // postcode-indexed for UK businesses.
  const queryParts = [venue.name];
  if (venue.town) queryParts.push(venue.town);
  if (venue.postcode) queryParts.push(venue.postcode);
  queryParts.push("Scotland, UK");
  const query = queryParts.join(", ");

  const input = {
    searchStringsArray: [query],
    // Cap at 1 — we just want THE place, not a list of nearby alternatives.
    maxCrawledPlacesPerSearch: 1,
    language: "en",
    countryCode: "gb",
    skipClosedPlaces: false, // we still want hours even if place is "permanently closed"
    includeImages: true,
    maxImages: MAX_PHOTOS,
  };

  // Start run.
  const startUrl = `${APIFY_API}/acts/${APIFY_GMAPS_ACTOR}/runs?token=${encodeURIComponent(token)}`;
  let runId: string;
  let datasetId: string;
  try {
    const res = await fetch(startUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    if (!res.ok) {
      const text = await res.text();
      return {
        venueId: venue.id,
        ok: false,
        reason: `Apify start failed (${res.status}): ${text.slice(0, 200)}`,
        photos: [],
        openingHoursJson: null,
        openingHoursText: null,
        googleMapsUrl: null,
      };
    }
    const json = await res.json();
    runId = json?.data?.id;
    datasetId = json?.data?.defaultDatasetId;
    if (!runId || !datasetId) {
      return {
        venueId: venue.id,
        ok: false,
        reason: "Apify didn't return runId / datasetId.",
        photos: [],
        openingHoursJson: null,
        openingHoursText: null,
        googleMapsUrl: null,
      };
    }
  } catch (e: any) {
    return {
      venueId: venue.id,
      ok: false,
      reason: `Apify start exception: ${e?.message ?? e}`,
      photos: [],
      openingHoursJson: null,
      openingHoursText: null,
      googleMapsUrl: null,
    };
  }

  // Poll until finished or deadline.
  const deadline = Date.now() + APIFY_DEADLINE_MS;
  while (true) {
    if (Date.now() > deadline) {
      try {
        await fetch(
          `${APIFY_API}/actor-runs/${runId}/abort?token=${encodeURIComponent(token)}`,
          { method: "POST" },
        );
      } catch { /* swallow */ }
      return {
        venueId: venue.id,
        ok: false,
        reason: "Timed out after 45s.",
        photos: [],
        openingHoursJson: null,
        openingHoursText: null,
        googleMapsUrl: null,
      };
    }
    try {
      const res = await fetch(
        `${APIFY_API}/actor-runs/${runId}?token=${encodeURIComponent(token)}`,
      );
      if (res.ok) {
        const json = await res.json();
        const status = json?.data?.status ?? "RUNNING";
        if (status === "SUCCEEDED" || status === "FAILED" || status === "ABORTED" || status === "TIMED-OUT") {
          break;
        }
      }
    } catch { /* transient — keep polling */ }
    await new Promise((r) => setTimeout(r, 1500));
  }

  // Fetch results.
  let items: any[] = [];
  try {
    const res = await fetch(
      `${APIFY_API}/datasets/${datasetId}/items?token=${encodeURIComponent(token)}&format=json`,
    );
    if (res.ok) {
      items = await res.json();
      if (!Array.isArray(items)) items = [];
    }
  } catch { /* treat as empty */ }

  if (items.length === 0) {
    return {
      venueId: venue.id,
      ok: false,
      reason: "Google returned no results for this venue.",
      photos: [],
      openingHoursJson: null,
      openingHoursText: null,
      googleMapsUrl: null,
    };
  }

  const item = items[0];
  const photos = extractPhotos(item, MAX_PHOTOS);
  const { json: openingHoursJson, text: openingHoursText } = extractOpeningHours(item);
  const googleMapsUrl = typeof item?.url === "string" ? item.url : null;

  // Auto-fill the non-visual metadata (website, phone, rating, address,
  // coords, place id) right away — these don't need admin review like photos
  // do. Only fills fields the venue is currently MISSING; never overwrites.
  try { await autoFillVenueMeta(venue.id, item); } catch { /* best effort */ }

  return {
    venueId: venue.id,
    ok: true,
    photos,
    openingHoursJson,
    openingHoursText,
    googleMapsUrl,
  };
}

// Write website / phone / rating / address / coords / place_id from the Apify
// Google Maps result — but only for fields the venue doesn't already have, so
// manual data is never clobbered. Runs at scan time (no review step).
async function autoFillVenueMeta(venueId: string, item: any): Promise<void> {
  const website = typeof item?.website === "string" && /^https?:\/\//.test(item.website) ? item.website : null;
  const phone = typeof item?.phone === "string" ? item.phone : (typeof item?.phoneUnformatted === "string" ? item.phoneUnformatted : null);
  const rating = typeof item?.totalScore === "number" ? item.totalScore : null;
  const reviews = typeof item?.reviewsCount === "number" ? item.reviewsCount : null;
  const address = typeof item?.address === "string" ? item.address : (typeof item?.street === "string" ? item.street : null);
  const lat = typeof item?.location?.lat === "number" ? item.location.lat : null;
  const lng = typeof item?.location?.lng === "number" ? item.location.lng : null;
  const placeId = typeof item?.placeId === "string" ? item.placeId : null;

  const sb = createServiceClient();
  const { data: cur } = await sb
    .from("venues")
    .select("website, phone, google_rating, address, latitude, longitude, google_place_id")
    .eq("id", venueId)
    .maybeSingle();
  if (!cur) return;

  const u: Record<string, unknown> = {};
  if (!cur.website && website) u.website = website;
  if (!cur.phone && phone) u.phone = phone;
  if (cur.google_rating == null && rating != null) {
    u.google_rating = rating;
    if (reviews != null) u.google_rating_count = reviews;
  }
  if (!cur.address && address) u.address = address;
  if (cur.latitude == null && lat != null) { u.latitude = lat; u.longitude = lng; }
  if (!cur.google_place_id && placeId) u.google_place_id = placeId;

  if (Object.keys(u).length > 0) {
    u.google_synced_at = new Date().toISOString();
    await sb.from("venues").update(u).eq("id", venueId);
  }
}

// Apify's place actor returns photos under a few possible keys depending
// on version — we look at all of them and dedupe.
function extractPhotos(item: any, max: number): string[] {
  const candidates: string[] = [];
  const fields = [item?.imageUrls, item?.images, item?.imageCategories];
  for (const f of fields) {
    if (Array.isArray(f)) {
      for (const entry of f) {
        if (typeof entry === "string") candidates.push(entry);
        else if (entry && typeof entry.imageUrl === "string") candidates.push(entry.imageUrl);
      }
    }
  }
  // Dedupe while preserving order so the most "hero" photo stays first.
  const seen = new Set<string>();
  const out: string[] = [];
  for (const url of candidates) {
    if (seen.has(url)) continue;
    seen.add(url);
    out.push(url);
    if (out.length >= max) break;
  }
  return out;
}

// Apify returns openingHours as e.g.
//   [{ day: "Monday", hours: "11 AM to 11 PM" }, { day: "Tuesday", hours: "Closed" }, ...]
// Convert to our 24-hour {mon: {open, close, closed}} shape.
function extractOpeningHours(item: any): {
  json: OpeningHoursJson | null;
  text: string | null;
} {
  const arr = item?.openingHours;
  if (!Array.isArray(arr) || arr.length === 0) return { json: null, text: null };

  const out: Partial<OpeningHoursJson> = {};
  const textLines: string[] = [];

  for (const row of arr) {
    if (!row || typeof row.day !== "string") continue;
    const dayKey = dayNameToKey(row.day);
    if (!dayKey) continue;
    const hoursStr: string = typeof row.hours === "string" ? row.hours : "";
    textLines.push(`${row.day}: ${hoursStr}`);

    if (/closed/i.test(hoursStr)) {
      out[dayKey] = { closed: true };
      continue;
    }
    if (/24\s*hours|open\s*24/i.test(hoursStr)) {
      out[dayKey] = { open: "00:00", close: "23:59" };
      continue;
    }
    const parsed = parseHoursRange(hoursStr);
    if (parsed) out[dayKey] = parsed;
  }

  // Only return the JSON map if we actually got at least one day parsed
  // — otherwise the UI shows an empty object that looks like real data.
  const json = Object.keys(out).length > 0 ? (out as OpeningHoursJson) : null;
  const text = textLines.length > 0 ? textLines.join("\n") : null;
  return { json, text };
}

function dayNameToKey(name: string): DayKey | null {
  const n = name.toLowerCase().slice(0, 3);
  switch (n) {
    case "mon": return "mon";
    case "tue": return "tue";
    case "wed": return "wed";
    case "thu": return "thu";
    case "fri": return "fri";
    case "sat": return "sat";
    case "sun": return "sun";
    default: return null;
  }
}

// Parse e.g. "11 AM to 11 PM", "11:30 AM to 12:00 AM", "5 PM to midnight"
// into { open: "11:00", close: "23:00" } using 24-hour HH:MM.
function parseHoursRange(s: string): { open: string; close: string } | null {
  if (!s) return null;
  const lower = s.toLowerCase().replace(/\s+/g, " ").trim();
  // Normalise common Google phrasings.
  const normalised = lower
    .replace(/midnight/g, "12:00 am")
    .replace(/noon/g, "12:00 pm")
    .replace(/–|—/g, "-")
    .replace(/\bto\b/g, "-");

  const parts = normalised.split("-").map((p) => p.trim()).filter(Boolean);
  if (parts.length !== 2) return null;
  const open = parseClock(parts[0]);
  const close = parseClock(parts[1]);
  if (!open || !close) return null;
  return { open, close };
}

function parseClock(s: string): string | null {
  const m = /^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i.exec(s.trim());
  if (!m) return null;
  let hour = parseInt(m[1], 10);
  const minute = m[2] ? parseInt(m[2], 10) : 0;
  const ampm = m[3]?.toLowerCase();
  if (Number.isNaN(hour) || Number.isNaN(minute)) return null;
  if (ampm === "pm" && hour < 12) hour += 12;
  if (ampm === "am" && hour === 12) hour = 0;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

// Process ONE batch of missing-data venues via Apify: fill photos, hours,
// website, phone, rating, address, coords for anything missing. Marks each
// venue tried. Returns how many were processed / actually filled.
async function enrichBatch(
  sb: ReturnType<typeof createServiceClient>,
  token: string,
  cap: number,
): Promise<{ processed: number; filled: number }> {
  const { data } = await sb
    .from("venues")
    .select("id, name, slug, postcode, address, gallery_image_urls, opening_hours_json, cover_photo_url, google_photo_url, city:cities ( slug, name )")
    .eq("approved", true)
    .is("google_enrich_attempt", null)
    .or("cover_photo_url.is.null,opening_hours_json.is.null,website.is.null")
    .limit(Math.max(1, Math.min(12, cap)));
  const rows = data ?? [];
  if (rows.length === 0) return { processed: 0, filled: 0 };

  const toVN = (v: any): VenueNeedingScan => {
    const addr: string = typeof v.address === "string" ? v.address : "";
    const town = addr.split(",").map((s) => s.trim()).find((s) => s.length > 0) ?? null;
    return {
      id: v.id, name: v.name, slug: v.slug,
      citySlug: v.city?.slug ?? null, cityName: v.city?.name ?? null,
      town, postcode: v.postcode,
      hasPhotos: Array.isArray(v.gallery_image_urls) && v.gallery_image_urls.length > 0,
      hasHours: v.opening_hours_json != null,
    };
  };

  const scanned = await Promise.all(
    rows.map((v: any) => scanOneVenue(toVN(v), token).then((r) => ({ v, r })).catch(() => ({ v, r: null as ScanResult | null }))),
  );

  let filled = 0;
  for (const { v, r } of scanned) {
    try {
      if (r && r.ok) {
        const update: Record<string, unknown> = {};
        if (r.photos.length > 0) {
          const cur: string[] = Array.isArray(v.gallery_image_urls) ? v.gallery_image_urls : [];
          update.gallery_image_urls = Array.from(new Set([...cur, ...r.photos])).slice(0, MAX_PHOTOS);
          if (!v.cover_photo_url && !v.google_photo_url) update.google_photo_url = r.photos[0];
        }
        if (r.openingHoursJson && v.opening_hours_json == null) {
          update.opening_hours_json = r.openingHoursJson;
          if (r.openingHoursText) update.opening_hours = r.openingHoursText;
        }
        if (Object.keys(update).length > 0) { await sb.from("venues").update(update).eq("id", v.id); filled++; }
      }
    } catch { /* skip */ }
    await sb.from("venues").update({ google_enrich_attempt: new Date().toISOString() }).eq("id", v.id);
  }
  return { processed: rows.length, filled };
}

async function remainingToEnrich(sb: ReturnType<typeof createServiceClient>): Promise<number> {
  const { count } = await sb.from("venues").select("id", { count: "exact", head: true })
    .eq("approved", true).is("google_enrich_attempt", null)
    .or("cover_photo_url.is.null,opening_hours_json.is.null,website.is.null");
  return count ?? 0;
}

// Cron entry: one batch, secret-gated (safe to expose as a server action).
export async function runEnrichmentCron(
  secret: string,
  limit = 10,
): Promise<{ ok: boolean; processed?: number; filled?: number; remaining?: number; error?: string }> {
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) return { ok: false, error: "unauthorized" };
  const token = process.env.APIFY_TOKEN;
  if (!token) return { ok: false, error: "APIFY_TOKEN not set" };
  const sb = createServiceClient();
  const { processed, filled } = await enrichBatch(sb, token, limit);
  return { ok: true, processed, filled, remaining: await remainingToEnrich(sb) };
}

// Admin "Run now": loop batches until the time budget runs out — clears far
// more per click than the 30-min cron.
export async function runEnrichmentNow(): Promise<{ ok: boolean; processed?: number; filled?: number; remaining?: number; error?: string }> {
  const ctx = await requireAdmin();
  if (!ctx) return { ok: false, error: "Admins only." };
  const token = process.env.APIFY_TOKEN;
  if (!token) return { ok: false, error: "APIFY_TOKEN isn't set on the server yet." };
  const sb = createServiceClient();
  const start = Date.now();
  let processed = 0, filled = 0;
  while (Date.now() - start < 230_000) { // stay under the page's 300s budget
    const r = await enrichBatch(sb, token, 12);
    processed += r.processed;
    filled += r.filled;
    if (r.processed === 0) break;
  }
  return { ok: true, processed, filled, remaining: await remainingToEnrich(sb) };
}

// Public action: scan a batch of venues in parallel. Returns the
// results to the client which will then show a preview UI.

export async function scanVenueBatch(
  venues: VenueNeedingScan[],
): Promise<{ error: string } | { ok: true; results: ScanResult[] }> {
  const ctx = await requireAdmin();
  if (!ctx) return { error: "Admins only." };
  const token = process.env.APIFY_TOKEN;
  if (!token) return { error: "APIFY_TOKEN env var isn't set on the server." };

  if (venues.length === 0) return { ok: true, results: [] };
  if (venues.length > 10) {
    // Hard cap on batch size — protects us from a misclicking admin
    // submitting 100 venues at once and blowing the action's timeout.
    return { error: "Batch size capped at 10 venues — split into smaller runs." };
  }

  const results = await Promise.all(
    venues.map((v) => scanOneVenue(v, token)),
  );
  return { ok: true, results };
}

// -----------------------------------------------------------
// PHASE 3: persist admin's chosen photos + parsed hours.
// -----------------------------------------------------------

export type SavePayload = {
  venueId: string;
  // Photos the admin ticked to keep. Capped at 6 client-side; we
  // re-cap server-side as belt + braces.
  photos: string[];
  // The parsed JSON hours, or null if admin opted not to save them.
  openingHoursJson: OpeningHoursJson | null;
  // Optional free-text hours — saved to the existing opening_hours column
  // so the venue page has both a structured + a human-readable copy.
  openingHoursText: string | null;
};

export async function saveScannedVenueData(
  payload: SavePayload,
): Promise<{ error: string } | { ok: true }> {
  const ctx = await requireAdmin();
  if (!ctx) return { error: "Admins only." };
  const sb = createServiceClient();

  const photos = (payload.photos ?? []).slice(0, MAX_PHOTOS);
  const update: Record<string, unknown> = {};

  // Merge photos with any existing ones (don't blow away manual uploads).
  if (photos.length > 0) {
    const { data: existing } = await sb
      .from("venues")
      .select("gallery_image_urls")
      .eq("id", payload.venueId)
      .maybeSingle();
    const current: string[] = Array.isArray(existing?.gallery_image_urls)
      ? existing!.gallery_image_urls as string[]
      : [];
    const seen = new Set(current);
    const merged = [...current];
    for (const p of photos) {
      if (!seen.has(p)) {
        seen.add(p);
        merged.push(p);
      }
    }
    update.gallery_image_urls = merged.slice(0, MAX_PHOTOS);
  }

  if (payload.openingHoursJson) update.opening_hours_json = payload.openingHoursJson;
  if (payload.openingHoursText) update.opening_hours = payload.openingHoursText;

  if (Object.keys(update).length === 0) {
    return { error: "Nothing selected to save." };
  }

  // Fetch slug + city slug first so we can revalidate the public page
  // (the gallery is what we just changed — admin wants to see it live).
  const { data: venueInfo } = await sb
    .from("venues")
    .select("slug, city:cities(slug)")
    .eq("id", payload.venueId)
    .maybeSingle();

  const { error } = await sb.from("venues").update(update).eq("id", payload.venueId);
  if (error) return { error: error.message };

  if (venueInfo?.slug) {
    const citySlug = (venueInfo as any).city?.slug;
    if (citySlug) {
      revalidatePath(`/${citySlug}/venues/${venueInfo.slug}`);
    }
  }
  return { ok: true };
}
