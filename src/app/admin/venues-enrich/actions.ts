"use server";

// Refresh existing venues' missing metadata (address, postcode, lat/long,
// website, phone) by looking each one up in OpenStreetMap via Overpass.
//
// Different from /admin/discover-venues, which only creates NEW venues.
// This tool matches OSM results against rows you already have and proposes
// fills for any blank fields. Never overwrites existing data — admin can
// safely run it without losing manual edits.
//
// Strategy: one Overpass call per city (cheap, free, ~3s) covering the
// whole region. Match OSM pubs to DB venues by normalised name. For each
// match, diff fields and surface the gaps.

import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { revalidatePath } from "next/cache";

const OVERPASS_API = "https://overpass-api.de/api/interpreter";
const NOMINATIM_API = "https://nominatim.openstreetmap.org/search";
// Hard cap on the Overpass call. Overpass occasionally hangs or
// returns multi-minute responses on large queries; without a timeout
// the whole action could get killed by Vercel before returning.
//
// 70s budget: regions with many nearby_areas (Fife has 13: Dunfermline,
// Kirkcaldy, St Andrews, Cupar, Leven, Anstruther…) generate big
// Overpass queries that union all the town areas. With the chunked
// architecture, Phase 1 does ONLY Overpass + matching (no Nominatim),
// so it can safely use most of the 90s page maxDuration budget.
// Phase 2 batches run separately with their own ~10s budget each.
const OVERPASS_FETCH_TIMEOUT_MS = 70_000;
// Nominatim usage policy: max 1 request/second from a single IP. We sleep
// 1.1s between calls to leave a safety margin.
const NOMINATIM_DELAY_MS = 1100;
// Per-fetch timeout — protects the budget from a single stuck request.
const NOMINATIM_FETCH_TIMEOUT_MS = 4000;
// How many Nominatim lookups per processNominatimBatch call.
// 5 venues * (~2s each: 1.1s rate-limit + ~0.9s fetch) ≈ 10s, well
// within Vercel's per-function ceiling. Caller (the client) loops
// through batches until all pending venues are processed.
const NOMINATIM_BATCH_SIZE = 5;

function normaliseVenueName(name: string): string {
  return String(name)
    .toLowerCase()
    .trim()
    .replace(/^the\s+/, "")
    .replace(/[^a-z0-9]+/g, "");
}

export type EnrichableField =
  | "address"
  | "postcode"
  | "latitude"
  | "longitude"
  | "website"
  | "phone";

export type EnrichmentSuggestion = {
  venueId: string;
  venueName: string;
  venueSlug: string;
  citySlug: string | null;
  // Current value in the DB (null = missing).
  current: Record<EnrichableField, string | number | null>;
  // What OSM has. null = OSM didn't carry that field either.
  suggested: Record<EnrichableField, string | number | null>;
  // Only the fields where suggested is set AND current is blank — the
  // ones we'd actually fill in. UI uses this to pre-tick checkboxes.
  fillable: EnrichableField[];
  matchSource: "osm-area" | "osm-place-radius" | "osm-nominatim";
};

export type FindEnrichmentsResult =
  | { error: string }
  | {
      ok: true;
      cityName: string;
      citySlug: string;
      towns: string[];
      total: number; // venues scanned
      matched: number; // matched in OSM (any source)
      matchedViaOverpass: number; // bulk Overpass match
      matchedViaNominatim: number; // free-text Nominatim match — 0 in phase 1
      missingInOsm: number; // venues with no OSM hit at all — final number
                            // not known until pendingNominatim is processed
      nominatimSkipped: number; // 0 in phase 1; deprecated, kept for client compat
      suggestions: EnrichmentSuggestion[];
      // Venues that didn't match via Overpass. Client feeds these to
      // processNominatimBatch in chunks of NOMINATIM_BATCH_SIZE, so each
      // round-trip stays inside Vercel's function ceiling regardless of
      // how big the region is. Older single-call enrichment hit Vercel's
      // ceiling on regions like Fife (160+ venues).
      pendingNominatim: PendingNominatimVenue[];
    };

// Stateless handoff between Phase 1 (Overpass + matching) and Phase 2
// (per-venue Nominatim lookups). The client holds the list of pending
// venues and sends one batch at a time to processNominatimBatch. We
// include everything Phase 2 needs to build a final EnrichmentSuggestion
// so it doesn't have to re-fetch venue rows from the DB.
export type PendingNominatimVenue = {
  venueId: string;
  venueName: string;
  venueSlug: string;
  citySlug: string | null;
  // Town to disambiguate the Nominatim search (e.g. "Anstruther" instead
  // of just "Scotland" — Nominatim is much more accurate with a town hint).
  townName: string;
  // Current DB values so Phase 2 can build the diff without re-querying.
  current: Record<EnrichableField, string | number | null>;
};

async function requireAdmin() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: prof } = await supabase
    .from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (prof?.role !== "admin") return null;
  return { userId: user.id };
}

/**
 * Scan OSM for venues in a given city and diff against the existing rows
 * so admin can pick which blank fields to fill in. Optional festivalId
 * narrows scope to venues linked to that festival (and only within their
 * own cities — handles festivals that span cities like Montrose Music Fest).
 */
export async function findVenueEnrichments(scope: {
  citySlug?: string;
  festivalId?: string;
}): Promise<FindEnrichmentsResult> {
  const ctx = await requireAdmin();
  if (!ctx) return { error: "Admins only." };
  if (!scope.citySlug && !scope.festivalId) {
    return { error: "Pass a citySlug or festivalId." };
  }

  const sb = createServiceClient();

  // 1. Resolve the venue set + city info.
  let cityRow: { id: string; name: string; slug: string; nearby_areas: string[] } | null = null;
  let venueRows: Array<{
    id: string;
    name: string;
    slug: string;
    address: string | null;
    postcode: string | null;
    phone: string | null;
    website: string | null;
    latitude: number | null;
    longitude: number | null;
    city: { name: string; slug: string; nearby_areas: any } | null;
  }> = [];

  if (scope.festivalId) {
    // Venues linked to this festival, with their city info.
    const { data: links } = await sb
      .from("festival_venues")
      .select(
        "venue:venues(id, name, slug, address, postcode, phone, website, latitude, longitude, city:cities(name, slug, nearby_areas))",
      )
      .eq("festival_id", scope.festivalId);
    venueRows = (links ?? [])
      .map((l: any) => l.venue)
      .filter(Boolean);
    if (venueRows.length === 0) {
      return { error: "No venues linked to that festival." };
    }
    // Pick the first venue's city as the OSM scope. If the festival spans
    // multiple cities, this currently only enriches venues in the first
    // city — a more advanced version would batch per-city.
    const firstCity = (venueRows.find((v) => v.city)?.city ?? null) as any;
    if (!firstCity) {
      return { error: "Festival's venues have no city set — can't scan OSM." };
    }
    cityRow = {
      id: "",
      name: firstCity.name,
      slug: firstCity.slug,
      nearby_areas: Array.isArray(firstCity.nearby_areas) ? firstCity.nearby_areas : [],
    };
  } else {
    const { data: city } = await sb
      .from("cities")
      .select("id, name, slug, nearby_areas")
      .eq("slug", scope.citySlug!)
      .maybeSingle();
    if (!city) return { error: `City "${scope.citySlug}" not found.` };
    cityRow = {
      id: city.id,
      name: city.name,
      slug: city.slug,
      nearby_areas: Array.isArray(city.nearby_areas) ? (city.nearby_areas as string[]) : [],
    };
    const { data: vs } = await sb
      .from("venues")
      .select(
        "id, name, slug, address, postcode, phone, website, latitude, longitude, city:cities(name, slug, nearby_areas)",
      )
      .eq("city_id", city.id);
    venueRows = (vs ?? []) as any;
  }

  if (venueRows.length === 0) {
    return {
      ok: true,
      cityName: cityRow.name,
      citySlug: cityRow.slug,
      towns: [],
      total: 0,
      matched: 0,
      matchedViaOverpass: 0,
      matchedViaNominatim: 0,
      missingInOsm: 0,
      nominatimSkipped: 0,
      suggestions: [],
      pendingNominatim: [],
    };
  }

  const towns: string[] = cityRow.nearby_areas.length > 0
    ? cityRow.nearby_areas
    : [cityRow.name];

  // 2. One Overpass query for the whole region — same shape as discover-venues.
  const escapedNames = towns.map((t) => t.replace(/"/g, '\\"'));
  const areaClauses = escapedNames
    .map((t) => `area["name"="${t}"]["admin_level"];`)
    .join("\n  ");
  const placeClauses = escapedNames
    .map(
      (t) =>
        `node["place"~"^(city|town|village|hamlet|suburb|locality)$"]["name"="${t}"];`,
    )
    .join("\n  ");
  // Widened filter so hotels (Park Hotel, George Hotel etc), inns, and
  // golf clubs aren't missed. OSM uses multiple top-level tags for
  // accommodation/leisure so we OR them together via Overpass's nwr/regex.
  const amenityFilter = `["amenity"~"^(pub|bar|nightclub|biergarten|social_club|theatre|restaurant|cafe|cinema|fast_food|community_centre|events_venue)$"]`;
  const tourismFilter = `["tourism"~"^(hotel|guest_house|hostel)$"]`;
  const leisureFilter = `["leisure"~"^(golf_course|sports_centre|stadium|dance|bowling_alley)$"]`;
  const overpassQuery = `
[out:json][timeout:30];
(
  ${areaClauses}
)->.areas;
(
  ${placeClauses}
)->.centers;
(
  node(area.areas)${amenityFilter};
  way(area.areas)${amenityFilter};
  node(around.centers:3000)${amenityFilter};
  way(around.centers:3000)${amenityFilter};
  node(area.areas)${tourismFilter};
  way(area.areas)${tourismFilter};
  node(around.centers:3000)${tourismFilter};
  way(around.centers:3000)${tourismFilter};
  node(area.areas)${leisureFilter};
  way(area.areas)${leisureFilter};
  node(around.centers:3000)${leisureFilter};
  way(around.centers:3000)${leisureFilter};
);
out center tags;
`.trim();

  let elements: any[] = [];
  try {
    // Hard 30s timeout — without this the fetch can hang for minutes
    // on large or pathological queries, and the whole action gets
    // killed by Vercel before returning.
    const res = await fetch(OVERPASS_API, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
        "User-Agent": "TheBuzzGuide/1.0 (https://www.thebuzzguide.co.uk)",
      },
      body: `data=${encodeURIComponent(overpassQuery)}`,
      signal: AbortSignal.timeout(OVERPASS_FETCH_TIMEOUT_MS),
    });
    if (!res.ok) {
      const text = await res.text();
      return { error: `Overpass ${res.status}: ${text.slice(0, 400)}` };
    }
    const json = await res.json();
    elements = Array.isArray(json?.elements) ? json.elements : [];
  } catch (e: any) {
    const isTimeout = e?.name === "TimeoutError" || /aborted/i.test(String(e?.message ?? ""));
    return {
      error: isTimeout
        ? `Overpass took longer than ${OVERPASS_FETCH_TIMEOUT_MS / 1000}s and was cancelled. OSM is busy — wait a few minutes and try again. If it keeps timing out, the region might just be too big for one query (Fife at 13 towns is at the edge of what's reasonable).`
        : `Overpass request failed: ${e?.message ?? e}`,
    };
  }

  // 3. Index OSM results by normalised name.
  type OsmHit = {
    name: string;
    address: string | null;
    postcode: string | null;
    website: string | null;
    phone: string | null;
    latitude: number | null;
    longitude: number | null;
    source: "osm-area" | "osm-place-radius" | "osm-nominatim";
  };
  const osmByName = new Map<string, OsmHit>();
  for (const el of elements) {
    const tags = el?.tags ?? {};
    const name = String(tags.name ?? "").trim();
    if (!name) continue;
    const norm = normaliseVenueName(name);
    if (!norm || osmByName.has(norm)) continue;

    const addrParts = [tags["addr:housenumber"], tags["addr:street"]]
      .filter(Boolean)
      .join(" ");
    const cityPart =
      tags["addr:city"] ?? tags["addr:town"] ?? tags["addr:village"];
    const address =
      [addrParts, cityPart, tags["addr:postcode"]].filter(Boolean).join(", ") ||
      null;
    const lat = typeof el.lat === "number" ? el.lat : el.center?.lat ?? null;
    const lon = typeof el.lon === "number" ? el.lon : el.center?.lon ?? null;

    osmByName.set(norm, {
      name,
      address,
      postcode:
        typeof tags["addr:postcode"] === "string"
          ? String(tags["addr:postcode"]).toUpperCase()
          : null,
      website: tags["website"] ?? tags["contact:website"] ?? null,
      phone: tags["phone"] ?? tags["contact:phone"] ?? null,
      latitude: lat,
      longitude: lon,
      // Best-effort tagging — area- vs radius- matched. Both are valid;
      // surfaces in the UI so admin knows whether the polygon match was
      // strict (area) or proximity-only (radius).
      source: "osm-area",
    });
  }

  // 4a. First pass — match each DB venue against the bulk Overpass index by
  //     normalised name. Anything not matched here gets a Nominatim
  //     free-text lookup as a fallback (slow but accurate).
  const matchedFromOverpass: Array<{ venue: typeof venueRows[number]; hit: OsmHit }> = [];
  const unmatchedAfterOverpass: typeof venueRows = [];
  for (const v of venueRows) {
    const norm = normaliseVenueName(v.name);
    const hit = osmByName.get(norm);
    if (hit) {
      matchedFromOverpass.push({ venue: v, hit });
    } else {
      unmatchedAfterOverpass.push(v);
    }
  }

  // 4b. Phase 1 STOPS here. Venues that didn't match via Overpass go
  // into a `pendingNominatim` list that the client will feed to the
  // separate processNominatimBatch action in chunks. This was a single
  // in-line loop before, but that hit Vercel's per-function ceiling
  // (~60s) on regions with 50+ venues to look up — the OSM rate limit
  // is 1 request/sec so 50 venues alone takes 55s, blowing the budget
  // and 504-ing the response. Chunking off-loads the time budget to
  // the client's polling loop.
  const pendingNominatim: PendingNominatimVenue[] = unmatchedAfterOverpass.map((v) => ({
    venueId: v.id,
    venueName: v.name,
    venueSlug: v.slug,
    citySlug: v.city?.slug ?? null,
    townName: v.city?.name ?? cityRow.name,
    current: {
      address: v.address,
      postcode: v.postcode,
      latitude: v.latitude,
      longitude: v.longitude,
      website: v.website,
      phone: v.phone,
    },
  }));

  // 4c. Build the suggestions list from just the Overpass matches for now.
  // Nominatim matches get appended client-side as processNominatimBatch
  // round-trips complete.
  const allMatched = [...matchedFromOverpass];
  const matchedIds = new Set(allMatched.map((m) => m.venue.id));
  // `missingInOsm` and `matchedViaNominatim` are unknown until pending
  // venues are processed. The client will update its own counts as
  // batches complete. Set to 0 here; the response shape stays the same
  // for backward compat.
  const missingInOsm = 0;
  const suggestions: EnrichmentSuggestion[] = [];

  for (const { venue: v, hit } of allMatched) {
    const current: EnrichmentSuggestion["current"] = {
      address: v.address,
      postcode: v.postcode,
      latitude: v.latitude,
      longitude: v.longitude,
      website: v.website,
      phone: v.phone,
    };
    const suggested: EnrichmentSuggestion["suggested"] = {
      address: hit.address,
      postcode: hit.postcode,
      latitude: hit.latitude,
      longitude: hit.longitude,
      website: hit.website,
      phone: hit.phone,
    };
    // Fillable = OSM has it AND DB is blank.
    const fillable: EnrichableField[] = [];
    for (const k of [
      "address",
      "postcode",
      "latitude",
      "longitude",
      "website",
      "phone",
    ] as EnrichableField[]) {
      const cur = current[k];
      const sug = suggested[k];
      const curBlank =
        cur === null ||
        cur === undefined ||
        (typeof cur === "string" && cur.trim() === "");
      const sugSet =
        sug !== null &&
        sug !== undefined &&
        (typeof sug !== "string" || sug.trim() !== "");
      if (curBlank && sugSet) fillable.push(k);
    }

    // Skip suggestions where nothing is fillable — no point surfacing
    // a "perfect match" row with nothing to do.
    if (fillable.length === 0) continue;

    suggestions.push({
      venueId: v.id,
      venueName: v.name,
      venueSlug: v.slug,
      citySlug: v.city?.slug ?? null,
      current,
      suggested,
      fillable,
      matchSource: hit.source,
    });
  }

  // Sort: venues with the most blank fields fillable first.
  suggestions.sort((a, b) => b.fillable.length - a.fillable.length);

  return {
    ok: true,
    cityName: cityRow.name,
    citySlug: cityRow.slug,
    towns,
    total: venueRows.length,
    matched: matchedIds.size,
    matchedViaOverpass: matchedFromOverpass.length,
    matchedViaNominatim: 0, // Updated by client as pending venues process
    missingInOsm,
    nominatimSkipped: 0, // No longer used; the client processes all pending
    suggestions,
    pendingNominatim,
  };
}

// ---------- Phase 2: per-venue Nominatim lookups ----------

export type ProcessNominatimBatchResult =
  | { error: string }
  | {
      ok: true;
      // New suggestions from Nominatim matches in this batch. May be
      // fewer than `venues.length` — venues with no OSM hit OR with
      // nothing fillable just don't generate a suggestion.
      newSuggestions: EnrichmentSuggestion[];
      // Count of venues in this batch that didn't match Nominatim at all.
      // Client uses this to maintain a running "missing in OSM" total.
      missedCount: number;
    };

/**
 * Process one chunk of pending Nominatim lookups. Called repeatedly by
 * the client with batches of NOMINATIM_BATCH_SIZE venues until the
 * client's pending queue is empty. Each call is bounded at ~10s wall
 * clock (5 venues × ~2s each) which sits comfortably under any Vercel
 * function ceiling, so this scales to arbitrarily large regions.
 */
export async function processNominatimBatch(
  venues: PendingNominatimVenue[],
): Promise<ProcessNominatimBatchResult> {
  const ctx = await requireAdmin();
  if (!ctx) return { error: "Admins only." };
  if (!Array.isArray(venues) || venues.length === 0) {
    return { ok: true, newSuggestions: [], missedCount: 0 };
  }
  // Sanity cap — caller is supposed to slice into batches but be
  // defensive in case a client bug sends a giant array.
  const batch = venues.slice(0, NOMINATIM_BATCH_SIZE);

  const newSuggestions: EnrichmentSuggestion[] = [];
  let missedCount = 0;
  for (let i = 0; i < batch.length; i++) {
    const v = batch[i];
    // Respect Nominatim's 1 req/sec policy. Skip the sleep on the
    // first iteration so a batch of 1 isn't artificially slow.
    if (i > 0) await new Promise((r) => setTimeout(r, NOMINATIM_DELAY_MS));
    const hit = await nominatimLookup(v.venueName, v.townName);
    if (!hit) {
      missedCount += 1;
      continue;
    }
    const suggested: EnrichmentSuggestion["suggested"] = {
      address: hit.address,
      postcode: hit.postcode,
      latitude: hit.latitude,
      longitude: hit.longitude,
      website: hit.website,
      phone: hit.phone,
    };
    const fillable: EnrichableField[] = [];
    for (const k of [
      "address",
      "postcode",
      "latitude",
      "longitude",
      "website",
      "phone",
    ] as EnrichableField[]) {
      const cur = v.current[k];
      const sug = suggested[k];
      const curBlank =
        cur === null ||
        cur === undefined ||
        (typeof cur === "string" && cur.trim() === "");
      const sugSet =
        sug !== null &&
        sug !== undefined &&
        (typeof sug !== "string" || sug.trim() !== "");
      if (curBlank && sugSet) fillable.push(k);
    }
    if (fillable.length === 0) {
      // OSM has the venue but everything's already populated — don't
      // surface a no-op row. Doesn't count as "missed" either.
      continue;
    }
    newSuggestions.push({
      venueId: v.venueId,
      venueName: v.venueName,
      venueSlug: v.venueSlug,
      citySlug: v.citySlug,
      current: v.current,
      suggested,
      fillable,
      matchSource: "osm-nominatim",
    });
  }

  return { ok: true, newSuggestions, missedCount };
}

/**
 * Free-text venue lookup via OSM's Nominatim search. Used as a fallback
 * when the bulk Overpass query didn't find a venue by exact name.
 * Returns null on miss / network error / rate-limit. Caller is
 * responsible for the 1s-between-calls rate limit.
 */
async function nominatimLookup(
  venueName: string,
  townName: string,
): Promise<{
  name: string;
  address: string | null;
  postcode: string | null;
  website: string | null;
  phone: string | null;
  latitude: number | null;
  longitude: number | null;
  source: "osm-nominatim";
} | null> {
  const q = `${venueName}, ${townName}, Scotland, UK`;
  const url = `${NOMINATIM_API}?q=${encodeURIComponent(q)}&format=json&limit=1&addressdetails=1&countrycodes=gb`;
  // Abort if Nominatim hangs — without this a single stuck request would
  // eat the entire phase budget.
  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => controller.abort(), NOMINATIM_FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: {
        Accept: "application/json",
        "User-Agent": "TheBuzzGuide/1.0 (https://www.thebuzzguide.co.uk)",
      },
      signal: controller.signal,
    });
    clearTimeout(timeoutHandle);
    if (!res.ok) return null;
    const json = await res.json();
    if (!Array.isArray(json) || json.length === 0) return null;
    const hit = json[0];
    const lat = parseFloat(hit?.lat);
    const lon = parseFloat(hit?.lon);
    if (Number.isNaN(lat) || Number.isNaN(lon)) return null;

    const addr = hit?.address ?? {};
    // Build a compact UK-style address from the addressdetails.
    const addrParts = [
      addr.house_number ? `${addr.house_number} ${addr.road ?? ""}`.trim() : addr.road,
      addr.city ?? addr.town ?? addr.village ?? addr.suburb,
      addr.postcode,
    ].filter(Boolean);
    const address = addrParts.length > 0 ? addrParts.join(", ") : null;

    return {
      name: String(hit?.display_name ?? "").split(",")[0]?.trim() ?? venueName,
      address,
      postcode:
        typeof addr.postcode === "string" ? String(addr.postcode).toUpperCase() : null,
      // Nominatim doesn't carry website / phone directly. The bulk Overpass
      // pass is what surfaces those when tagged.
      website: null,
      phone: null,
      latitude: lat,
      longitude: lon,
      source: "osm-nominatim",
    };
  } catch {
    clearTimeout(timeoutHandle);
    return null;
  }
}

export type ApplyEnrichmentsInput = Array<{
  venueId: string;
  fields: Partial<Record<EnrichableField, string | number | null>>;
}>;

export type ApplyEnrichmentsResult =
  | { error: string }
  | { ok: true; updated: number; fieldsWritten: number };

/**
 * Apply selected field fills to venues. We re-check that each target field
 * is still blank before writing — defends against a race where admin edits
 * the venue between scan and apply.
 */
export async function applyVenueEnrichments(
  updates: ApplyEnrichmentsInput,
): Promise<ApplyEnrichmentsResult> {
  const ctx = await requireAdmin();
  if (!ctx) return { error: "Admins only." };
  if (updates.length === 0) return { ok: true, updated: 0, fieldsWritten: 0 };

  const sb = createServiceClient();
  let updated = 0;
  let fieldsWritten = 0;

  for (const u of updates) {
    // Re-read current state to avoid overwriting work the user did between
    // scan and apply.
    const { data: row } = await sb
      .from("venues")
      .select("id, address, postcode, phone, website, latitude, longitude")
      .eq("id", u.venueId)
      .maybeSingle();
    if (!row) continue;

    const payload: Record<string, any> = {};
    for (const [k, v] of Object.entries(u.fields)) {
      const cur = (row as any)[k];
      const curBlank =
        cur === null ||
        cur === undefined ||
        (typeof cur === "string" && cur.trim() === "");
      const sugSet =
        v !== null &&
        v !== undefined &&
        (typeof v !== "string" || v.trim() !== "");
      if (curBlank && sugSet) {
        payload[k] = v;
        fieldsWritten++;
      }
    }

    if (Object.keys(payload).length > 0) {
      const { error } = await sb
        .from("venues")
        .update(payload)
        .eq("id", u.venueId);
      if (!error) updated++;
    }
  }

  revalidatePath("/admin");
  revalidatePath("/admin/venues-enrich");
  return { ok: true, updated, fieldsWritten };
}
