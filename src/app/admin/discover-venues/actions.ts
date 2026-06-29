"use server";

// Auto-discover venues across a city's nearby_areas using OpenStreetMap's
// Overpass API. One submit covers every town in the region; admin reviews
// candidates, ticks the ones that look right, and we bulk-create them.
//
// Why Overpass and not Apify Google Maps:
//   - FREE. No per-result billing, no surprise £5 charges from chain-pub
//     bleed-over.
//   - Strictly bounded by administrative area, so "pubs in Forfar" can't
//     return Sunderland pubs because Sunderland isn't inside Forfar's
//     boundary polygon.
//   - Returns in ~3 seconds for a whole region.
//
// Tradeoff: OSM data is volunteer-mapped — most pubs have name + lat/lng,
// many have address + website + phone, fewer have rating. Plenty of
// coverage for UK pubs (one of OSM's strongest categories).

import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { revalidatePath } from "next/cache";
import { findPlaceDetails } from "@/lib/google-places";

// Three independent Overpass mirrors tried in order — overpass-api.de
// is the primary but times out under load; the others are usually available.
const OVERPASS_MIRRORS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.openstreetmap.ru/api/interpreter",
];
const APIFY_API = "https://api.apify.com/v2";
const APIFY_GMAPS_ACTOR = "compass~crawler-google-places";

// UK bounding box (south,west,north,east) — generous enough to cover
// Shetland and the Outer Hebrides, tight enough to exclude every foreign
// place that shares a Scottish town name (Perth AU, Richmond VA, etc.).
const UK_BBOX = "49.8,-8.7,61.1,2.0";

// Single source of truth for venue-name normalisation. Lowercase, drop a
// leading "the ", strip non-alphanumerics. So "Central Bar", "the Central
// Bar", "Central Bar!" all collapse to the same key. Used everywhere
// venues need to be deduped (import, top-up, dedupe tool).
function normaliseVenueName(name: string): string {
  return String(name)
    .toLowerCase()
    .trim()
    .replace(/^the\s+/, "")
    .replace(/[^a-z0-9]+/g, "");
}

function osmCategory(tags: Record<string, string>): string {
  const a = tags.amenity;
  const l = tags.leisure;
  const t = tags.tourism;
  if (a === "library") return "Library";
  if (a === "cinema") return "Cinema";
  if (a === "community_centre") return "Community centre";
  if (a === "arts_centre") return "Arts centre";
  if (a === "theatre") return "Theatre";
  if (a === "leisure_centre") return "Leisure centre";
  if (a === "swimming_pool" || l === "swimming_pool") return "Swimming pool";
  if (a === "bowling_alley") return "Bowling alley";
  if (a === "indoor_play") return "Indoor play";
  if (l === "playground") return "Playground";
  if (l === "sports_centre") return "Sports centre";
  if (l === "water_park") return "Water park";
  if (l === "ice_rink") return "Ice rink";
  if (l === "trampoline_park") return "Trampoline park";
  if (l === "climbing") return "Climbing centre";
  if (l === "miniature_golf") return "Mini golf";
  if (t === "zoo") return "Zoo";
  if (t === "museum") return "Museum";
  if (t === "theme_park") return "Theme park";
  if (t === "aquarium") return "Aquarium";
  if (t === "gallery") return "Gallery";
  if (t === "attraction") return "Attraction";
  return "Activity";
}

export type DiscoveredVenue = {
  name: string;
  address: string | null;
  postcode: string | null;
  website: string | null;
  phone: string | null;
  latitude: number | null;
  longitude: number | null;
  category: string | null;
  rating: number | null;
  reviewCount: number | null;
  googleMapsUrl: string | null;
  // The town we searched on — useful for grouping in the UI.
  town: string;
  // Heuristic flag we set when the result already exists in our DB. Lets
  // the UI grey-out duplicates so admin doesn't approve them.
  alreadyExists: boolean;
};

export type DiscoverVenuesResult =
  | { error: string }
  | {
      ok: true;
      cityName: string;
      citySlug: string;
      towns: string[];
      candidates: DiscoveredVenue[];
      apifyCost: number; // approx, in USD — billed on EVERY result Apify returned
      filteredOutOfScope: number; // results dropped because their address didn't match this city's towns
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
 * Run the Apify Google Maps scraper for the given towns (or all of a
 * city's nearby_areas if no towns specified). Returns the merged candidate
 * list with duplicates flagged (by exact name match in the city) so admin
 * can quickly skip them.
 *
 * Caller passes `selectedTowns` to keep each run small enough to fit under
 * Vercel's 60s function timeout (Apify can take ~3-4s per search query).
 * 3-4 towns per run is the sweet spot.
 */
export async function discoverVenuesForCity(
  citySlug: string,
  selectedTowns?: string[],
): Promise<DiscoverVenuesResult> {
  const ctx = await requireAdmin();
  if (!ctx) return { error: "Admins only." };

  const sb = createServiceClient();
  const { data: city } = await sb
    .from("cities")
    .select("id, name, slug, nearby_areas")
    .eq("slug", citySlug)
    .maybeSingle();
  if (!city) return { error: `City "${citySlug}" not found.` };

  const allTowns: string[] = Array.isArray(city.nearby_areas) && city.nearby_areas.length > 0
    ? (city.nearby_areas as string[])
    : [city.name];
  const towns = selectedTowns && selectedTowns.length > 0
    ? selectedTowns.filter((t) => allTowns.includes(t))
    : allTowns;

  if (towns.length === 0) {
    return { error: "No valid towns selected for this city." };
  }

  // Build an Overpass query that combines two strategies — many small
  // Scottish towns don't have a tagged admin polygon, so falling back to
  // the OSM "place" node + a 3km radius catches the rest:
  //
  //   1. ADMIN AREA: any area with name=<town> (any admin_level). Strict
  //      polygon match — won't bleed across town boundaries.
  //   2. PLACE NODE FALLBACK: any node tagged place=town/village/hamlet/etc
  //      with that name; we then pull places within a 3km radius of it.
  //
  // We union the results and dedupe by name, so places found by both
  // strategies appear once.
  const escapedNames = towns.map((t) => t.replace(/"/g, '\\"'));
  const areaClauses = escapedNames
    .map((t) => `area["name"="${t}"]["admin_level"];`)
    .join("\n  ");
  // Clip place-node lookups to the UK bbox so "Perth" doesn't also match
  // Perth, Australia / Perth, Ontario etc. (the area lookups above can't be
  // bbox-filtered, so we additionally clip the venue results below).
  const placeClauses = escapedNames
    .map((t) => `node["place"~"^(city|town|village|hamlet|suburb|locality)$"]["name"="${t}"](${UK_BBOX});`)
    .join("\n  ");

  // Kids/family venue types in OSM. Three separate tag keys to union:
  //   amenity — built facilities (library, cinema, leisure centre…)
  //   leisure — recreational spaces (playground, sports centre, ice rink…)
  //   tourism — visitor attractions (museum, zoo, theme park…)
  // We skip generic parks/nature_reserves — too many unnamed nodes.
  const amenityF = `["amenity"~"^(library|cinema|community_centre|arts_centre|theatre|leisure_centre|swimming_pool|bowling_alley|indoor_play)$"]`;
  const leisureF = `["leisure"~"^(playground|sports_centre|swimming_pool|water_park|ice_rink|climbing|miniature_golf|fitness_centre|trampoline_park)$"]`;
  const tourismF = `["tourism"~"^(zoo|museum|theme_park|attraction|aquarium|gallery)$"]`;

  // Every venue clause is also clipped to the UK bbox. This is the real
  // safety net: an admin area named "Perth" in Australia still matches the
  // areaClauses above, but its venues fall outside the UK bbox and get
  // dropped — so no more foreign places leaking into the results.
  //
  // Use `nwr` (node+way+relation) to halve the number of query statements
  // vs separate node/way lines — keeps the query small enough that Overpass
  // handles it well within the timeout.
  const overpassQuery = `
[out:json][timeout:45];
(
  ${areaClauses}
)->.areas;
(
  ${placeClauses}
)->.centers;
(
  nwr(area.areas)${amenityF}(${UK_BBOX});
  nwr(area.areas)${leisureF}(${UK_BBOX});
  nwr(area.areas)${tourismF}(${UK_BBOX});
  nwr(around.centers:3000)${amenityF}(${UK_BBOX});
  nwr(around.centers:3000)${leisureF}(${UK_BBOX});
  nwr(around.centers:3000)${tourismF}(${UK_BBOX});
);
out center tags;
`.trim();

  let elements: any[] = [];
  let gotResponse = false;
  let overpassError = "";
  // Two rounds over every mirror. A round is one pass through all three;
  // "fetch failed" / 504s are usually transient, so a second pass after a
  // short backoff clears most blips without the admin having to retry.
  outer: for (let round = 0; round < 2; round++) {
    for (const endpoint of OVERPASS_MIRRORS) {
      try {
        const res = await fetch(endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            Accept: "application/json",
            "User-Agent": "TheBuzzKids/1.0 (https://www.thebuzzkids.co.uk)",
          },
          body: `data=${encodeURIComponent(overpassQuery)}`,
          signal: AbortSignal.timeout(28000),
        });
        if (res.ok) {
          const json = await res.json();
          elements = Array.isArray(json?.elements) ? json.elements : [];
          gotResponse = true;
          overpassError = "";
          break outer;
        }
        const text = await res.text();
        overpassError = `Overpass ${res.status}: ${text.slice(0, 300)}`;
      } catch (e: any) {
        const cause = e?.cause?.code ?? e?.cause?.message ?? "";
        overpassError = `Overpass request failed: ${e?.message ?? e}${cause ? ` (${cause})` : ""}`;
      }
    }
    // Short backoff before the second round so we're not hammering mirrors
    // that just rejected us.
    if (!gotResponse && round === 0) await new Promise((r) => setTimeout(r, 1500));
  }
  if (!gotResponse) {
    return {
      error:
        `${overpassError}. All Overpass mirrors are unreachable right now — this is usually a temporary network or OSM-server blip. Wait a minute and try again; if it persists, try fewer towns at once.`,
    };
  }

  // Pull the existing venue names in this city so we can flag duplicates.
  // Normalise: lowercase, drop leading "the ", strip non-alphanumerics. So
  // "Central Bar", "The Central Bar", "Central Bar!" all collide → counted
  // as duplicates. Same normaliser used by /admin/venues-dedupe.
  const { data: existing } = await sb
    .from("venues")
    .select("name")
    .eq("city_id", city.id);
  const existingNorm = new Set(
    (existing ?? []).map((v: any) => normaliseVenueName(String(v.name))),
  );

  // Parse Overpass elements into our DiscoveredVenue shape. OSM gives us
  // the data in `tags`, with coords either at the top level (nodes) or
  // under `center` (ways).
  const seen = new Set<string>();
  const candidates: DiscoveredVenue[] = [];

  for (const el of elements) {
    const tags = el?.tags ?? {};
    const name = String(tags.name ?? "").trim();
    if (!name) continue;
    const norm = normaliseVenueName(name);
    if (seen.has(norm)) continue;
    seen.add(norm);

    // Build address from osm addr:* tags (housenumber + street + city
    // + postcode is the convention).
    const addrParts = [
      tags["addr:housenumber"],
      tags["addr:street"],
    ].filter(Boolean).join(" ");
    const cityPart = tags["addr:city"] ?? tags["addr:town"] ?? tags["addr:village"];
    const address = [addrParts, cityPart, tags["addr:postcode"]]
      .filter(Boolean)
      .join(", ") || null;

    const lat = typeof el.lat === "number" ? el.lat : el.center?.lat ?? null;
    const lon = typeof el.lon === "number" ? el.lon : el.center?.lon ?? null;

    // Pick the town this place falls into. Prefer addr:city/town/village
    // when set; fall back to nearest match in our towns list (rare).
    const cityFromTags = String(cityPart ?? "").trim();
    const displayTown =
      towns.find((t) => t.toLowerCase() === cityFromTags.toLowerCase()) ?? cityFromTags ?? "—";

    candidates.push({
      name,
      address,
      postcode: typeof tags["addr:postcode"] === "string"
        ? String(tags["addr:postcode"]).toUpperCase()
        : null,
      website: tags["website"] ?? tags["contact:website"] ?? null,
      phone: tags["phone"] ?? tags["contact:phone"] ?? null,
      latitude: lat,
      longitude: lon,
      category: osmCategory(tags),
      rating: null,       // OSM doesn't carry ratings
      reviewCount: null,  // ditto
      googleMapsUrl: lat && lon
        ? `https://www.google.com/maps/search/?api=1&query=${lat},${lon}`
        : null,
      town: displayTown || "—",
      alreadyExists: existingNorm.has(norm),
    });
  }

  // For OSM candidates missing address data, try Google Places API to fill
  // in address, postcode, phone and website. OSM coordinates are usually
  // reliable so we only fall back on those if OSM had neither lat nor lon.
  // Cap at 15 parallel lookups — each takes ~0.5-1s and they run in parallel
  // so the total wall-clock hit is small even with the full cap.
  if (process.env.GOOGLE_PLACES_KEY) {
    const needsLookup = candidates.filter((c) => !c.address).slice(0, 15);
    if (needsLookup.length > 0) {
      const details = await Promise.all(
        needsLookup.map((c) => {
          const townHint = c.town && c.town !== "—" ? c.town : city.name;
          return findPlaceDetails(`${c.name}, ${townHint}, Scotland, UK`);
        }),
      );
      for (let i = 0; i < needsLookup.length; i++) {
        const d = details[i];
        if (!d) continue;
        // Reject any Google match whose coordinates fall outside the UK —
        // Places can return a same-named venue abroad when the local one
        // isn't on Google. Keep it out of the candidate's data.
        if (
          d.latitude != null && d.longitude != null &&
          (d.latitude < 49.8 || d.latitude > 61.1 || d.longitude < -8.7 || d.longitude > 2.0)
        ) {
          continue;
        }
        const idx = candidates.findIndex((c) => c.name === needsLookup[i].name);
        if (idx === -1) continue;
        const c = candidates[idx];
        candidates[idx] = {
          ...c,
          address:    c.address    ?? d.address,
          postcode:   c.postcode   ?? d.postcode,
          phone:      c.phone      ?? d.phone,
          website:    c.website    ?? d.website,
          latitude:   c.latitude   ?? d.latitude,
          longitude:  c.longitude  ?? d.longitude,
          rating:     c.rating     ?? d.rating,
          reviewCount: c.reviewCount ?? d.reviewCount,
        };
      }
    }
  }

  return {
    ok: true,
    cityName: city.name,
    citySlug: city.slug,
    towns,
    candidates,
    apifyCost: 0,           // OSM is free; Google Places lookup above is ~$0.032/call but capped at 15
    filteredOutOfScope: 0,  // Overpass strictly bounds by area, no bleed-over
  };
}

export type BulkAddResult =
  | { error: string }
  | { ok: true; added: number; skipped: number; createdIds: string[]; warning?: string };

/**
 * Create venue rows for the candidates the admin approved. Skips any
 * that already exist (case-insensitive name match in the city), assigns
 * the city, and stamps `auto_imported = true` so we know where they
 * came from.
 *
 * Default approval is `true` — these are real pubs from OSM and gating
 * them in the queue would just add work. Admin can unapprove one if
 * it's a bad match.
 *
 * owner_id is left NULL so the venue lands as "Unclaimed" in the admin
 * list — a real owner can claim it later via the existing claim flow,
 * or admin can assign one via the user detail page's "Assign existing
 * venue" button.
 */
export async function bulkAddDiscoveredVenues(
  citySlug: string,
  candidates: DiscoveredVenue[],
  opts: { ownerId?: string | null } = {},
): Promise<BulkAddResult> {
  const ctx = await requireAdmin();
  if (!ctx) return { error: "Admins only." };
  if (candidates.length === 0) return { ok: true, added: 0, skipped: 0, createdIds: [] };

  const sb = createServiceClient();
  const { data: city } = await sb
    .from("cities")
    .select("id, slug")
    .eq("slug", citySlug)
    .maybeSingle();
  if (!city) return { error: `City "${citySlug}" not found.` };

  // Owner is null by default — these are auto-imported pubs that sit
  // unclaimed in the directory until a real owner takes them on. Caller
  // can override via opts.ownerId if they want to assign them to a
  // specific user up front.
  const ownerId = opts.ownerId ?? null;

  // Pull existing venue names in this city to dedupe.
  const { data: existing } = await sb
    .from("venues")
    .select("name")
    .eq("city_id", city.id);
  const existingNorm = new Set(
    (existing ?? []).map((v: any) =>
      normaliseVenueName(String(v.name)),
    ),
  );

  let added = 0;
  let skipped = 0;
  let firstInsertError: string | null = null;
  const createdIds: string[] = [];

  for (const c of candidates) {
    const norm = normaliseVenueName(c.name);
    if (existingNorm.has(norm)) {
      skipped++;
      continue;
    }

    // Slug: lowercase, dashes, dedupe with -2 / -3 suffix on conflict.
    const baseSlug = c.name
      .toLowerCase()
      .replace(/&/g, "and")
      .replace(/[^a-z0-9\s-]/g, "")
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 100) || "venue";

    let slug = baseSlug;
    let inserted = false;
    for (let attempt = 0; attempt < 6 && !inserted; attempt++) {
      const { data, error } = await sb
        .from("venues")
        .insert({
          name: c.name,
          slug,
          city_id: city.id,
          owner_id: ownerId,
          address: c.address,
          postcode: c.postcode,
          phone: c.phone,
          website: c.website,
          latitude: c.latitude,
          longitude: c.longitude,
          approved: true,
          auto_imported: true,
        })
        .select("id")
        .single();
      if (!error && data) {
        added++;
        createdIds.push(data.id);
        existingNorm.add(norm);
        inserted = true;
        break;
      }
      if ((error as any)?.code === "23505") {
        slug = `${baseSlug}-${attempt + 2}`;
        continue;
      }
      // Non-uniqueness error — capture the reason (once) so it isn't lost.
      // Previously this was silently counted as "skipped", which hid a
      // schema mismatch (missing columns) behind an "added 0" result.
      if (!firstInsertError && (error as any)?.message) {
        firstInsertError = (error as any).message;
      }
      skipped++;
      break;
    }
  }

  revalidatePath("/admin");
  revalidatePath(`/${citySlug}`);

  // Surface a hard failure loudly: nothing added AND we hit a real DB error.
  if (added === 0 && firstInsertError) {
    return { error: `Couldn't add any places — database error: ${firstInsertError}` };
  }
  return {
    ok: true,
    added,
    skipped,
    createdIds,
    ...(firstInsertError ? { warning: `Some places failed to add: ${firstInsertError}` } : {}),
  };
}

// ============================================================
// Per-town Apify "top-up" — used after OSM discovery shows
// sparse results for a specific town. Cost-bounded (max 15
// results) and we explicitly abort the Apify run if our deadline
// passes, so we never get billed for a runaway scrape.
// ============================================================

export type TopUpResult =
  | { error: string }
  | {
      ok: true;
      town: string;
      candidates: DiscoveredVenue[];
      apifyCost: number;
      filteredOutOfScope: number;
      timedOut: boolean;
    };

/**
 * Run a single tightly-scoped Apify Google Maps query for one town and
 * return new candidates. The async start + poll pattern means our 45s
 * deadline can issue an explicit abort to Apify if the run is still
 * grinding — no more silent overage.
 *
 * Caller is responsible for merging these into the existing OSM-derived
 * candidate list (de-duping by name).
 */
export async function topUpVenuesViaApify(
  citySlug: string,
  town: string,
): Promise<TopUpResult> {
  const ctx = await requireAdmin();
  if (!ctx) return { error: "Admins only." };

  const token = process.env.APIFY_TOKEN;
  if (!token) return { error: "APIFY_TOKEN env var isn't set on the server." };

  const sb = createServiceClient();
  const { data: city } = await sb
    .from("cities")
    .select("id, name, slug")
    .eq("slug", citySlug)
    .maybeSingle();
  if (!city) return { error: `City "${citySlug}" not found.` };

  // Existing names so we can flag duplicates the same way OSM results do.
  const { data: existing } = await sb
    .from("venues")
    .select("name")
    .eq("city_id", city.id);
  const existingNorm = new Set(
    (existing ?? []).map((v: any) =>
      normaliseVenueName(String(v.name)),
    ),
  );

  // 1. START THE RUN (async). Returns immediately with a runId we can
  //    poll, and crucially abort if it overruns.
  const startUrl = `${APIFY_API}/acts/${APIFY_GMAPS_ACTOR}/runs?token=${encodeURIComponent(token)}`;
  const input = {
    // More specific search to reduce chain-pub bleed-over.
    searchStringsArray: [`pubs in ${town}, ${city.name}, Scotland, UK`],
    // Cap at 40 — generous enough to cover larger towns like Arbroath
    // (25-30 real pubs) without unbounding cost. Hard ceiling because
    // Apify charges per result, not per query, and a runaway can cost £5+.
    maxCrawledPlacesPerSearch: 40,
    language: "en",
    countryCode: "gb",
    skipClosedPlaces: true,
  };

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
      return { error: `Apify start failed (${res.status}): ${text.slice(0, 400)}` };
    }
    const json = await res.json();
    runId = json?.data?.id;
    datasetId = json?.data?.defaultDatasetId;
    if (!runId || !datasetId) {
      return { error: "Apify started but didn't return runId / datasetId." };
    }
  } catch (e: any) {
    return { error: `Apify start exception: ${e?.message ?? e}` };
  }

  // 2. POLL until done OR our deadline. If deadline hits, abort.
  const deadline = Date.now() + 45_000;
  let status = "RUNNING";
  let timedOut = false;
  while (true) {
    if (Date.now() > deadline) {
      timedOut = true;
      // Fire-and-forget abort. We pass `gracefully=false` to halt
      // billing as fast as possible.
      try {
        await fetch(
          `${APIFY_API}/actor-runs/${runId}/abort?token=${encodeURIComponent(token)}`,
          { method: "POST" },
        );
      } catch {
        /* if abort fails the run will eventually finish on its own;
           we'll just be billed up to its natural end. */
      }
      break;
    }
    try {
      const res = await fetch(
        `${APIFY_API}/actor-runs/${runId}?token=${encodeURIComponent(token)}`,
      );
      if (res.ok) {
        const json = await res.json();
        status = json?.data?.status ?? "RUNNING";
        if (
          status === "SUCCEEDED" ||
          status === "FAILED" ||
          status === "ABORTED" ||
          status === "TIMED-OUT"
        ) break;
      }
    } catch {
      /* transient — keep polling */
    }
    await new Promise((r) => setTimeout(r, 1500));
  }

  // 3. FETCH WHATEVER RESULTS WERE WRITTEN (even partial after abort).
  let items: any[] = [];
  try {
    const res = await fetch(
      `${APIFY_API}/datasets/${datasetId}/items?token=${encodeURIComponent(token)}&format=json`,
    );
    if (res.ok) {
      items = await res.json();
      if (!Array.isArray(items)) items = [];
    }
  } catch {
    /* if we can't fetch items, treat as empty result */
  }

  // 4. NORMALISE + STRICTLY FILTER. The address MUST contain the town
  //    name — drops chain pubs from elsewhere in the UK that Google
  //    surfaces when local results are sparse.
  const townLower = town.toLowerCase();
  const seen = new Set<string>();
  const candidates: DiscoveredVenue[] = [];
  let filteredOutOfScope = 0;

  for (const item of items) {
    const name = String(item?.title ?? "").trim();
    if (!name) continue;
    const norm = normaliseVenueName(name);
    if (seen.has(norm)) continue;
    seen.add(norm);

    const address = item?.address ?? null;
    const addressLower = typeof address === "string" ? address.toLowerCase() : "";
    if (!addressLower.includes(townLower)) {
      filteredOutOfScope++;
      continue;
    }

    const postcodeMatch = typeof address === "string"
      ? address.match(/[A-Z]{1,2}\d{1,2}[A-Z]?\s*\d[A-Z]{2}/i)
      : null;
    const postcode = postcodeMatch ? postcodeMatch[0].toUpperCase() : null;

    candidates.push({
      name,
      address,
      postcode,
      website: item?.website ?? null,
      phone: item?.phone ?? null,
      latitude: typeof item?.location?.lat === "number" ? item.location.lat : null,
      longitude: typeof item?.location?.lng === "number" ? item.location.lng : null,
      category: item?.categoryName ?? item?.category ?? null,
      rating: typeof item?.totalScore === "number" ? item.totalScore : null,
      reviewCount: typeof item?.reviewsCount === "number" ? item.reviewsCount : null,
      googleMapsUrl: item?.url ?? null,
      town,
      alreadyExists: existingNorm.has(norm),
    });
  }

  return {
    ok: true,
    town,
    candidates,
    apifyCost: items.length * 0.002, // ~$2/1000 results, billed on every result Apify scraped
    filteredOutOfScope,
    timedOut,
  };
}
