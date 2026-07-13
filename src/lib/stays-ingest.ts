// "Places to stay" ingest — pulls family-friendly accommodation for one area
// from the Apify Google Maps scraper (compass~crawler-google-places, the same
// actor the venue tools use), classifies each into one of four types, dedupes,
// and inserts into the `stays` table. Runs server-side where APIFY_TOKEN lives.
//
// Four searches per area (specific-first so dedupe keeps the more specific
// type): glamping, caravan/holiday parks, self-catering cottages, family
// hotels. Booking links (affiliate) are filled in a later phase.

import { createServiceClient } from "@/lib/supabase/service";

const APIFY = "https://api.apify.com/v2";
const ACTOR = "compass~crawler-google-places";
const RUN_DEADLINE_MS = 180_000;

export type StayType = "glamping" | "caravan" | "cottage" | "hotel";

const SEARCHES: { type: StayType; suffix: string }[] = [
  { type: "glamping", suffix: "glamping" },
  { type: "caravan", suffix: "caravan parks and holiday parks" },
  { type: "cottage", suffix: "holiday cottages and self catering" },
  { type: "hotel", suffix: "family hotels" },
];
const PRIORITY: Record<StayType, number> = { glamping: 3, caravan: 2, cottage: 1, hotel: 0 };

// Keep only rows that read like accommodation; drop restaurants/attractions
// Google sometimes mixes into the results.
const ACCOM_RE =
  /(hotel|motel|inn\b|lodge|resort|cottage|self.?cater|holiday|guest\s?house|bed\s?(and|&)\s?breakfast|b&b|caravan|camp(site|ground)?|holiday park|glamp|chalet|cabin|\bpod\b|hostel|apartment|villa)/i;
const REJECT_RE =
  /(restaurant|cafe|coffee|takeaway|fast food|museum|golf course|attraction|store|shop|supermarket|\bbar\b|\bpub\b)/i;

// Keyword signals per type, so a single listing can be tagged with EVERY type
// it offers (a holiday park with static caravans AND glamping pods = both).
const TYPE_KW: Record<StayType, RegExp> = {
  glamping: /(glamp|\bpod\b|yurt|shepherd\s?hut|safari\s?tent|bell\s?tent|geo\s?dome|\bdome\b)/i,
  caravan: /(caravan|holiday\s?park|static|touring|camp(site|ing|ground)?|pitch|\bhut\b)/i,
  cottage: /(cottage|self.?cater|self.?contained|\bchalet\b|\blodge\b)/i,
  hotel: /(hotel|\binn\b|resort|\bspa\b)/i,
};

export type StaySample = {
  type: StayType;
  types: StayType[];
  name: string;
  rating: number | null;
  address: string | null;
  category: string | null;
  hasPhoto: boolean;
  hasSite: boolean;
};

export type StaysIngestResult = {
  ok: boolean;
  dry: boolean;
  area: string;
  raw: number;
  kept: number;
  rejected: number;    // not accommodation
  wrongArea: number;   // accommodation, but outside the searched region
  counts: Record<StayType, number>;
  inserted: number;
  samples: StaySample[];
  warnings: string[];
  error?: string;
};

function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 60);
}
function normName(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}
function cleanAddress(a: string | null): string | null {
  if (!a) return null;
  const out = a
    .replace(/^\s*[A-Z0-9]{2,6}\+[A-Z0-9]{2,4}[\s,]*/i, "")
    .replace(/[\s,]*(United Kingdom|UK)\s*$/i, "")
    .replace(/\s{2,}/g, " ")
    .replace(/^[\s,]+/, "")
    .trim();
  return out || null;
}
function postcodeOf(a: string | null): string | null {
  const m = a && /([A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2})/i.exec(a);
  return m ? m[1].toUpperCase().replace(/\s+/, " ") : null;
}
function photosOf(item: any, max = 4): string[] {
  const out: string[] = [];
  for (const f of [item?.imageUrls, item?.images]) {
    if (Array.isArray(f)) {
      for (const e of f) {
        const u = typeof e === "string" ? e : e?.imageUrl;
        if (u && !out.includes(u)) out.push(u);
        if (out.length >= max) return out;
      }
    }
  }
  return out;
}

// Outward postcode district, e.g. "DD8 3AB" -> "DD8", "PH10 6QX" -> "PH10".
function districtOf(pc: string | null): string | null {
  const m = pc && /^([A-Z]{1,2}\d{1,2})/i.exec(pc.trim());
  return m ? m[1].toUpperCase() : null;
}

// Each region's centre + its postcode districts, learned from the venues we
// already have coordinates/postcodes for. Used to reject stays Google returns
// that aren't actually in the searched region (its area search isn't fenced).
type CityGeo = {
  centroids: { slug: string; lat: number; lng: number; n: number }[];
  districts: Map<string, Set<string>>; // slug -> outward districts
  districtOwners: Map<string, Set<string>>; // district -> slugs that own it
};

async function loadCityGeo(sb: ReturnType<typeof createServiceClient>): Promise<CityGeo> {
  const { data: cities } = await sb.from("cities").select("id, slug");
  const idToSlug = new Map<string, string>((cities ?? []).map((c: any) => [c.id, c.slug]));
  const acc = new Map<string, { lat: number; lng: number; n: number }>();
  const districts = new Map<string, Set<string>>();
  const districtOwners = new Map<string, Set<string>>();

  let from = 0;
  for (;;) {
    const { data } = await sb
      .from("venues")
      .select("city_id, latitude, longitude, postcode")
      .eq("approved", true)
      .range(from, from + 999);
    const rows = data ?? [];
    for (const v of rows as any[]) {
      const slug = idToSlug.get(v.city_id);
      if (!slug) continue;
      if (typeof v.latitude === "number" && typeof v.longitude === "number") {
        const a = acc.get(slug) ?? { lat: 0, lng: 0, n: 0 };
        a.lat += v.latitude;
        a.lng += v.longitude;
        a.n += 1;
        acc.set(slug, a);
      }
      const d = districtOf(v.postcode);
      if (d) {
        if (!districts.has(slug)) districts.set(slug, new Set());
        districts.get(slug)!.add(d);
        if (!districtOwners.has(d)) districtOwners.set(d, new Set());
        districtOwners.get(d)!.add(slug);
      }
    }
    if (rows.length < 1000) break;
    from += 1000;
  }

  const centroids = [...acc.entries()].map(([slug, a]) => ({
    slug,
    lat: a.lat / a.n,
    lng: a.lng / a.n,
    n: a.n,
  }));
  return { centroids, districts, districtOwners };
}

function nearestCity(lat: number, lng: number, centroids: CityGeo["centroids"]): string | null {
  let best: string | null = null;
  let bestD = Infinity;
  const cosLat = Math.cos((lat * Math.PI) / 180);
  for (const c of centroids) {
    if (c.n < 3) continue; // ignore regions with too few venues to trust a centre
    const dx = (c.lng - lng) * cosLat;
    const dy = c.lat - lat;
    const d = dx * dx + dy * dy;
    if (d < bestD) {
      bestD = d;
      best = c.slug;
    }
  }
  return best;
}

// Is this stay actually in `areaSlug`? Coordinates first (nearest region wins,
// so Dundee hotels route to Dundee); postcode district as a fallback; when we
// can verify neither, keep it (admin reviews) rather than wrongly drop it.
function inArea(
  lat: number | null,
  lng: number | null,
  postcode: string | null,
  areaSlug: string,
  geo: CityGeo,
): boolean {
  const areaCentroid = geo.centroids.find((c) => c.slug === areaSlug);
  if (lat != null && lng != null && areaCentroid && areaCentroid.n >= 5) {
    return nearestCity(lat, lng, geo.centroids) === areaSlug;
  }
  const d = districtOf(postcode);
  if (d) {
    if (geo.districts.get(areaSlug)?.has(d)) return true;
    // District clearly belongs to a different region → reject.
    const owners = geo.districtOwners.get(d);
    if (owners && owners.size > 0 && !owners.has(areaSlug)) return false;
    return true; // unknown district — keep
  }
  return true; // no coords, no postcode — keep
}

async function runSearch(query: string, token: string, per: number): Promise<any[]> {
  const input = {
    searchStringsArray: [query],
    maxCrawledPlacesPerSearch: per,
    language: "en",
    countryCode: "gb",
    skipClosedPlaces: true,
    includeImages: true,
    maxImages: 4,
  };
  const start = await fetch(`${APIFY}/acts/${ACTOR}/runs?token=${encodeURIComponent(token)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!start.ok) throw new Error(`Apify start ${start.status}`);
  const { data } = await start.json();
  const runId = data.id as string;
  const ds = data.defaultDatasetId as string;
  const deadline = Date.now() + RUN_DEADLINE_MS;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 3000));
    const s = await fetch(`${APIFY}/actor-runs/${runId}?token=${encodeURIComponent(token)}`);
    const st = (await s.json())?.data?.status;
    if (["SUCCEEDED", "FAILED", "ABORTED", "TIMED-OUT"].includes(st)) break;
  }
  const res = await fetch(`${APIFY}/datasets/${ds}/items?token=${encodeURIComponent(token)}&format=json`);
  const items = await res.json();
  return Array.isArray(items) ? items : [];
}

type Seed = {
  name: string;
  norm_name: string;
  stay_type: StayType;
  types: Set<StayType>;
  address: string | null;
  postcode: string | null;
  latitude: number | null;
  longitude: number | null;
  website: string | null;
  phone: string | null;
  photo_url: string | null;
  gallery_image_urls: string[];
  google_rating: number | null;
  google_rating_count: number | null;
  google_place_id: string | null;
  category: string | null;
};

export async function ingestStaysForArea(
  area: string,
  opts: { dry: boolean; per?: number },
): Promise<StaysIngestResult> {
  const token = process.env.APIFY_TOKEN;
  const base: StaysIngestResult = {
    ok: false,
    dry: opts.dry,
    area,
    raw: 0,
    kept: 0,
    rejected: 0,
    wrongArea: 0,
    counts: { glamping: 0, caravan: 0, cottage: 0, hotel: 0 },
    inserted: 0,
    samples: [],
    warnings: [],
  };
  if (!token) return { ...base, error: "APIFY_TOKEN isn't set on the server." };
  const per = Math.max(5, Math.min(40, opts.per ?? 25));

  // Run the four searches concurrently.
  const results = await Promise.allSettled(
    SEARCHES.map((s) => runSearch(`${s.suffix} in ${area}, Scotland`, token, per)),
  );

  const byKey = new Map<string, Seed>();
  let raw = 0,
    rejected = 0;
  const warnings: string[] = [];

  results.forEach((r, i) => {
    const { type } = SEARCHES[i];
    if (r.status === "rejected") {
      warnings.push(`${type} search failed: ${r.reason?.message ?? r.reason}`);
      return;
    }
    const items = r.value;
    raw += items.length;
    for (const it of items) {
      const name = typeof it?.title === "string" ? it.title.trim() : null;
      if (!name) continue;
      const cat = [it?.categoryName, ...(Array.isArray(it?.categories) ? it.categories : [])]
        .filter(Boolean)
        .join(" ");
      const hay = `${name} ${cat}`;
      if ((REJECT_RE.test(cat) && !ACCOM_RE.test(name)) || !ACCOM_RE.test(hay)) {
        rejected++;
        continue;
      }
      const placeId = typeof it?.placeId === "string" ? it.placeId : null;
      const lat = typeof it?.location?.lat === "number" ? it.location.lat : null;
      const lng = typeof it?.location?.lng === "number" ? it.location.lng : null;
      const key = placeId || `${normName(name)}|${lat?.toFixed(3)}|${lng?.toFixed(3)}`;
      const addr = cleanAddress(typeof it?.address === "string" ? it.address : null);
      const photos = photosOf(it);
      const seed: Seed = {
        name,
        norm_name: normName(name),
        stay_type: type,
        types: new Set<StayType>([type]),
        address: addr,
        postcode: postcodeOf(typeof it?.address === "string" ? it.address : addr),
        latitude: lat,
        longitude: lng,
        website: /^https?:\/\//.test(it?.website || "") ? it.website : null,
        phone: it?.phone || it?.phoneUnformatted || null,
        photo_url: photos[0] || null,
        gallery_image_urls: photos,
        google_rating: typeof it?.totalScore === "number" ? it.totalScore : null,
        google_rating_count: typeof it?.reviewsCount === "number" ? it.reviewsCount : null,
        google_place_id: placeId,
        category: cat || null,
      };
      const prev = byKey.get(key);
      if (!prev) {
        byKey.set(key, seed);
      } else {
        // Same place from a second search — it offers this type too. Keep the
        // richer record (more photos / a website) but union the type set.
        prev.types.add(type);
        if (!prev.website && seed.website) prev.website = seed.website;
        if (prev.gallery_image_urls.length === 0 && seed.gallery_image_urls.length) {
          prev.gallery_image_urls = seed.gallery_image_urls;
          prev.photo_url = seed.photo_url;
        }
        if (prev.google_rating == null && seed.google_rating != null) {
          prev.google_rating = seed.google_rating;
          prev.google_rating_count = seed.google_rating_count;
        }
      }
    }
  });

  const allSeeds = [...byKey.values()];
  // Keyword-augment: tag every type a listing's name/category signals, then set
  // the primary to the most specific one present.
  for (const s of allSeeds) {
    const hay = `${s.name} ${s.category ?? ""}`;
    for (const t of Object.keys(TYPE_KW) as StayType[]) {
      if (TYPE_KW[t].test(hay)) s.types.add(t);
    }
    s.stay_type = [...s.types].reduce((a, b) => (PRIORITY[b] > PRIORITY[a] ? b : a), [...s.types][0]);
  }

  // Geo-gate: Google's area search bleeds in results from other regions
  // (Dundee hotels, Isle of Lewis, even England). Keep only stays that actually
  // sit in the searched region, using the coordinate clusters of venues we
  // already have. Runs in dry mode too, so the preview reflects what'll import.
  const sb = createServiceClient();
  const areaSlug = slugify(area);
  const geo = await loadCityGeo(sb);
  const wrongAreaExamples: string[] = [];
  const seeds = allSeeds.filter((s) => {
    const ok = inArea(s.latitude, s.longitude, s.postcode, areaSlug, geo);
    if (!ok && wrongAreaExamples.length < 12) {
      wrongAreaExamples.push(`${s.name}${s.address ? ` — ${s.address}` : ""}`);
    }
    return ok;
  });
  const wrongArea = allSeeds.length - seeds.length;
  if (wrongArea > 0) {
    warnings.push(`Dropped ${wrongArea} outside ${area}: ${wrongAreaExamples.join(" · ")}`);
  }

  const counts: Record<StayType, number> = { glamping: 0, caravan: 0, cottage: 0, hotel: 0 };
  for (const s of seeds) counts[s.stay_type]++;
  const samples: StaySample[] = seeds.map((s) => ({
    type: s.stay_type,
    types: [...s.types],
    name: s.name,
    rating: s.google_rating,
    address: s.address,
    category: s.category,
    hasPhoto: !!s.photo_url,
    hasSite: !!s.website,
  }));

  const out: StaysIngestResult = {
    ...base,
    ok: true,
    raw,
    kept: seeds.length,
    rejected,
    wrongArea,
    counts,
    samples,
    warnings,
  };
  if (opts.dry || seeds.length === 0) return out;

  // ---- insert ----
  const citySlug = areaSlug;
  const { data: city } = await sb.from("cities").select("id").eq("slug", citySlug).maybeSingle();
  const cityId = city?.id ?? null;

  // Pre-load existing slugs + place ids so new slugs stay unique and we only
  // insert genuinely-new places (upsert's ignoreDuplicates count is unreliable).
  const { data: existing } = await sb.from("stays").select("slug, google_place_id");
  const used = new Set<string>((existing ?? []).map((r: any) => r.slug).filter(Boolean));
  const knownPlaceIds = new Set<string>(
    (existing ?? []).map((r: any) => r.google_place_id).filter(Boolean),
  );

  const fresh = seeds.filter((s) => !s.google_place_id || !knownPlaceIds.has(s.google_place_id));
  const payload = fresh.map((s) => {
    let bslug = slugify(s.name) || "stay";
    let slug = bslug;
    let n = 2;
    while (used.has(slug)) slug = `${bslug}-${n++}`;
    used.add(slug);
    return {
      name: s.name,
      slug,
      norm_name: s.norm_name,
      stay_type: s.stay_type,
      stay_types: [...s.types],
      city_id: cityId,
      city_slug: citySlug,
      address: s.address,
      postcode: s.postcode,
      latitude: s.latitude,
      longitude: s.longitude,
      website: s.website,
      phone: s.phone,
      photo_url: s.photo_url,
      gallery_image_urls: s.gallery_image_urls,
      google_rating: s.google_rating,
      google_rating_count: s.google_rating_count,
      google_place_id: s.google_place_id,
      source: "google",
      approved: true,
    };
  });

  // Plain insert — we've already filtered to genuinely-new place ids and made
  // slugs unique above. (Can't upsert on google_place_id: its unique index is
  // partial — `where google_place_id is not null` — which Postgres won't accept
  // as an ON CONFLICT target.) On a batch error, fall back to row-by-row so one
  // bad row can't zero the whole batch.
  let inserted = 0;
  for (let i = 0; i < payload.length; i += 100) {
    const batch = payload.slice(i, i + 100);
    const { error } = await sb.from("stays").insert(batch);
    if (!error) { inserted += batch.length; continue; }
    for (const row of batch) {
      const { error: rowErr } = await sb.from("stays").insert(row);
      if (!rowErr) inserted++;
    }
    warnings.push(`insert (recovered row-by-row): ${error.message}`);
  }
  out.inserted = inserted;
  return out;
}

export type BulkStaysResult = {
  ok: boolean;
  areasDone: string[];             // area names imported this call
  inserted: number;
  counts: Record<StayType, number>;
  remaining: number;               // regions still to import after this call
  done: boolean;                   // nothing left
  warnings: string[];
  error?: string;
};

// Import every region that has no stays yet, looping until the time budget runs
// out. Resumable: an area counts as "done" once it has any stays, so calling
// this again picks up where it left off. The admin UI calls it in a loop so one
// click walks through all of Scotland across several requests.
export async function importRemainingAreas(): Promise<BulkStaysResult> {
  const counts: Record<StayType, number> = { glamping: 0, caravan: 0, cottage: 0, hotel: 0 };
  const out: BulkStaysResult = { ok: false, areasDone: [], inserted: 0, counts, remaining: 0, done: false, warnings: [] };
  if (!process.env.APIFY_TOKEN) return { ...out, error: "APIFY_TOKEN isn't set on the server." };

  const sb = createServiceClient();
  const { data: cities } = await sb.from("cities").select("slug, name").eq("active", true).order("name");
  const list = (cities ?? []) as { slug: string; name: string }[];
  const { data: staysRows } = await sb.from("stays").select("city_slug");
  const alreadyDone = new Set<string>((staysRows ?? []).map((r: any) => r.city_slug).filter(Boolean));
  const todo = list.filter((c) => !alreadyDone.has(c.slug));

  const start = Date.now();
  for (const c of todo) {
    if (Date.now() - start > 220_000) break; // stay under the route's 300s budget
    try {
      const r = await ingestStaysForArea(c.name, { dry: false });
      out.inserted += r.inserted;
      for (const k of Object.keys(counts) as StayType[]) counts[k] += r.counts[k];
      out.areasDone.push(c.name);
      if (r.warnings.length) out.warnings.push(`${c.name}: ${r.warnings[0]}`);
    } catch (e: any) {
      out.warnings.push(`${c.name}: ${e?.message ?? e}`);
      out.areasDone.push(c.name); // count as attempted so the loop advances
    }
  }
  out.ok = true;
  out.remaining = todo.length - out.areasDone.length;
  out.done = out.remaining === 0;
  return out;
}
