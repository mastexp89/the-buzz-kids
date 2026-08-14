// "/event + photo" import for the Kids Telegram admin bot: run AI extraction
// on a poster (fun day, fete, holiday club…), work out which place EACH
// extracted event is at (listing posters can cover several places), and
// create the events as PENDING so the admins group gets them back with
// one-tap Approve/Reject buttons.
//
// If a place isn't on the site yet it's created UNAPPROVED, filed under
// the region the poster's address/postcode points at, and the group gets a
// "Approve place + events / Discard" card for it.

import { createServiceClient } from "@/lib/supabase/service";
import { extractEvents } from "@/lib/extraction";
import { uploadPosterFromUrl } from "@/lib/poster-storage";

export type EventImportVenueResult = {
  venueName: string;
  venueId: string;
  venueSlug: string | null;
  citySlug: string | null;
  createdVenue: boolean;
  // False when we defaulted a new place's region to Dundee without solid
  // evidence — the group card asks admins to double-check it.
  citySure: boolean;
  // "Did you mean…?" — closest existing places, only when createdVenue.
  candidates: { id: string; name: string }[];
  created: { id: string; title: string; startTime: string }[];
  skippedDuplicates: string[];
};

export type EventImportOutcome =
  | {
      ok: true;
      venues: EventImportVenueResult[];
      // Titles of events whose place couldn't be determined at all.
      unplaced: string[];
    }
  | { ok: false; reason: "no_events" }
  | { ok: false; reason: "no_venue_hint" }
  | { ok: false; reason: "error"; message: string };

const norm = (s: string) =>
  (s || "").toLowerCase().replace(/^the\s+/i, "").replace(/[^a-z0-9]+/g, "");

const UK_POSTCODE_RE = /\b[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}\b/i;

/**
 * Region for a new place from the address/town/postcode on the poster:
 * postcode → postcodes.io admin_district → cities row (fuzzy), else a
 * direct region-name mention, else Dundee flagged as a guess.
 */
async function resolveCityFromLocation(
  cities: { id: string; slug: string; name: string }[],
  locationHint: string | null,
): Promise<{ cityId: string | null; citySlug: string | null; sure: boolean; lat: number | null; lng: number | null; postcode: string | null }> {
  const fallback = cities.find((c) => c.slug === "dundee") ?? null;
  const byLongestName = [...cities].sort((a, b) => b.name.length - a.name.length);
  const matchDistrict = (district: string) => {
    const d = norm(district);
    return byLongestName.find((c) => {
      const n = norm(c.name);
      return d === n || d.includes(n) || n.includes(d);
    }) ?? null;
  };

  const postcode = locationHint?.match(UK_POSTCODE_RE)?.[0]?.toUpperCase() ?? null;
  if (postcode) {
    try {
      const res = await fetch(
        `https://api.postcodes.io/postcodes/${encodeURIComponent(postcode.replace(/\s+/g, ""))}`,
      );
      if (res.ok) {
        const json: any = await res.json();
        const district: string | undefined = json?.result?.admin_district;
        const lat = typeof json?.result?.latitude === "number" ? json.result.latitude : null;
        const lng = typeof json?.result?.longitude === "number" ? json.result.longitude : null;
        const hit = district ? matchDistrict(district) : null;
        if (hit) return { cityId: hit.id, citySlug: hit.slug, sure: true, lat, lng, postcode };
        return { cityId: fallback?.id ?? null, citySlug: fallback?.slug ?? null, sure: false, lat, lng, postcode };
      }
    } catch { /* postcodes.io down — fall through */ }
  }

  if (locationHint) {
    const hintNorm = norm(locationHint);
    const hit = byLongestName.find((c) => hintNorm.includes(norm(c.name)));
    if (hit) return { cityId: hit.id, citySlug: hit.slug, sure: true, lat: null, lng: null, postcode };
  }

  return { cityId: fallback?.id ?? null, citySlug: fallback?.slug ?? null, sure: false, lat: null, lng: null, postcode };
}

// Generic place words stripped before similarity comparison, so "Camperdown
// Wildlife Centre" on a poster still resembles "Camperdown Park" variants.
const GENERIC_VENUE_WORDS = /\b(the|park|centre|center|hall|farm|museum|soft|play|club|cafe|kids|family)\b/gi;
const stripGeneric = (s: string) => norm(s.replace(GENERIC_VENUE_WORDS, " "));

/** Dice coefficient over letter bigrams — tolerant of OCR misreads. */
function bigramSim(a: string, b: string): number {
  if (a.length < 2 || b.length < 2) return a === b ? 1 : 0;
  const grams = (s: string) => {
    const m = new Map<string, number>();
    for (let i = 0; i < s.length - 1; i++) {
      const g = s.slice(i, i + 2);
      m.set(g, (m.get(g) ?? 0) + 1);
    }
    return m;
  };
  const ga = grams(a), gb = grams(b);
  let common = 0;
  for (const [g, n] of ga) common += Math.min(n, gb.get(g) ?? 0);
  return (2 * common) / (a.length - 1 + b.length - 1);
}

/**
 * Closest existing places to a name — the "did you mean…?" candidates on
 * the new-place card. Scores EVERY approved place by bigram similarity
 * (full + generic-words-stripped forms), so OCR misreads still surface
 * the right place. DETERMINISTIC for a given name (stable scoring +
 * alphabetical tiebreak): the webhook recomputes this at press time.
 */
export async function findVenueCandidates(
  name: string,
  limit = 3,
): Promise<{ id: string; name: string }[]> {
  const sb = createServiceClient();
  const all: { id: string; name: string }[] = [];
  for (let page = 0; page < 3; page++) {
    const { data } = await sb
      .from("venues")
      .select("id, name")
      .eq("approved", true)
      .order("id", { ascending: true })
      .range(page * 1000, page * 1000 + 999);
    all.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }

  const target = norm(name);
  const targetStripped = stripGeneric(name);
  const score = (v: { name: string }) => {
    const vn = norm(v.name);
    const vs = stripGeneric(v.name);
    if (vn === target) return 2;
    if (vn.length >= 4 && target.length >= 4 && (vn.includes(target) || target.includes(vn))) return 1.5;
    return Math.max(
      bigramSim(vn, target),
      targetStripped.length >= 4 && vs.length >= 4 ? bigramSim(vs, targetStripped) : 0,
    );
  };
  return all
    .map((v) => ({ v, s: score(v) }))
    .filter((x) => x.s >= 0.4)
    .sort((x, y) => y.s - x.s || x.v.name.localeCompare(y.v.name))
    .slice(0, limit)
    .map((x) => ({ id: x.v.id, name: x.v.name }));
}

/**
 * Type-to-search over saved places for the "wrong place?" reply flow —
 * a few letters is enough. Prefix matches rank first, then substring;
 * falls back to fuzzy scoring so typos still find something.
 */
export async function searchVenuesByQuery(
  query: string,
  limit = 8,
): Promise<{ id: string; name: string; citySlug: string | null }[]> {
  const sb = createServiceClient();
  const term = query.trim().replace(/[%_]/g, "");
  if (term.length < 2) return [];

  const { data } = await sb
    .from("venues")
    .select("id, name, city:cities(slug)")
    .eq("approved", true)
    .ilike("name", `%${term}%`)
    .limit(50);

  const rows = (data ?? []).map((v: any) => ({
    id: v.id as string,
    name: v.name as string,
    citySlug: (v.city?.slug ?? null) as string | null,
  }));

  if (rows.length > 0) {
    const t = norm(term);
    return rows
      .sort((a, b) => {
        const an = norm(a.name), bn = norm(b.name);
        const rank = (n: string) => (n.startsWith(t) ? 0 : 1);
        return rank(an) - rank(bn) || a.name.localeCompare(b.name);
      })
      .slice(0, limit);
  }

  // Nothing contained the term — fall back to typo-tolerant scoring.
  const fuzzy = await findVenueCandidates(term, limit);
  return fuzzy.map((v) => ({ id: v.id, name: v.name, citySlug: null }));
}

type VenueRow = {
  id: string;
  name: string;
  slug: string | null;
  address: string | null;
  city_id: string | null;
  city: { slug: string } | null;
};

/**
 * Strict matcher: two ilike probes + normalised containment compare.
 *
 * When several places share a name, the town printed on the poster
 * decides — without it a listing poster silently files events at the
 * wrong town's namesake.
 */
async function matchVenue(hint: string, locationHint?: string | null): Promise<VenueRow | null> {
  const sb = createServiceClient();
  const alphanumeric = hint.replace(/[^a-zA-Z0-9\s]/g, " ").trim();
  const firstWord =
    alphanumeric.replace(/^the\s+/i, "").split(/\s+/).find((w) => w.length >= 3) ??
    alphanumeric.slice(0, 5);
  const probe = (p: string) =>
    sb.from("venues")
      .select("id, name, slug, address, city_id, city:cities(slug)")
      .eq("approved", true)
      .ilike("name", `%${p.replace(/[%_]/g, "")}%`)
      .limit(30)
      .then(({ data }) => data ?? []);
  const [a, b] = await Promise.all([
    probe(firstWord.slice(0, 12)),
    firstWord.length > 4 ? probe(firstWord.slice(0, 4)) : Promise.resolve([]),
  ]);
  const candidates = [...a, ...b.filter((v: any) => !a.some((x: any) => x.id === v.id))];
  const hintNorm = norm(hint);
  const matches = candidates.filter((v: any) => {
    const vn = norm(v.name);
    return vn === hintNorm || (vn.length >= 4 && hintNorm.length >= 4 && (vn.includes(hintNorm) || hintNorm.includes(vn)));
  }) as unknown as VenueRow[];
  if (matches.length === 0) return null;
  if (matches.length === 1 || !locationHint) return matches[0];

  // Same-name places in different towns: score each by how well the
  // poster's town/address matches the place's address and region.
  const words = (locationHint.toLowerCase().match(/[a-z]{4,}/g) ?? []).map(norm).filter(Boolean);
  const scored = matches.map((v) => {
    const addr = norm(v.address ?? "");
    const region = norm(v.city?.slug ?? "");
    let s = 0;
    for (const w of words) {
      if (addr && addr.includes(w)) s += 2;
      if (region && region.includes(w)) s += 1;
    }
    return { v, s };
  });
  scored.sort((x, y) => y.s - x.s);
  return scored[0].v;
}

export async function importEventPoster(opts: {
  imageUrl: string;
  submittedBy: string;
  // Extra place-name text to try when the poster itself doesn't name one
  // (or names one we can't match) — e.g. the photo's caption. Only applied
  // when the poster resolves to a single place bucket, so a caption can't
  // mis-file a multi-place listing poster.
  venueHintOverride?: string | null;
}): Promise<EventImportOutcome> {
  const sb = createServiceClient();

  const { data: genres } = await sb.from("genres").select("id, slug, name").order("name");

  let extraction;
  try {
    extraction = await extractEvents({
      venueName: "Multiple places possible — read each event's venue off the poster",
      postedAt: new Date().toISOString(),
      imageUrls: [opts.imageUrl],
      availableCategories: (genres ?? []).map((g) => ({ slug: g.slug, name: g.name })),
    });
  } catch (e: any) {
    return { ok: false, reason: "error", message: e?.message ?? "extraction failed" };
  }

  const events = (extraction.events ?? []).filter((e) => {
    if (!e.title?.trim() || !e.starts_at) return false;
    return !Number.isNaN(new Date(e.starts_at).getTime());
  });
  if (events.length === 0) {
    const rawText = (extraction.raw?.content ?? []).find((b: any) => b.type === "text")?.text ?? "";
    console.warn("[telegram-event-import] extraction returned no events.", "raw:", String(rawText).slice(0, 500));
    return { ok: false, reason: "no_events" };
  }

  const override = (opts.venueHintOverride ?? "").replace(/\/\w+(@[\w_]+)?/g, "").trim() || null;

  // ---- Bucket events by their own venue_hint (listing posters can cover
  // several places). Hintless events join the majority bucket; with no
  // hints at all they form one bucket that leans on the caption override.
  const buckets = new Map<string, { hint: string | null; events: typeof events }>();
  const hintCounts = new Map<string, number>();
  for (const e of events) {
    const h = (e as any).venue_hint?.trim() || null;
    if (h) hintCounts.set(norm(h), (hintCounts.get(norm(h)) ?? 0) + 1);
  }
  const majorityHintNorm = [...hintCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  for (const e of events) {
    const h = (e as any).venue_hint?.trim() || null;
    const key = h ? norm(h) : majorityHintNorm ?? "";
    const bucket = buckets.get(key) ?? { hint: h, events: [] as typeof events };
    if (!bucket.hint && h) bucket.hint = h;
    bucket.events.push(e);
    buckets.set(key, bucket);
  }
  const singleBucket = buckets.size === 1;

  const results: EventImportVenueResult[] = [];
  const unplaced: string[] = [];
  const allCreatedIds: string[] = [];
  const genreLinks: { event_id: string; genre_id: string }[] = [];
  const genreSlugToId = new Map((genres ?? []).map((g) => [g.slug, g.id]));
  let citiesCache: { id: string; slug: string; name: string }[] | null = null;

  for (const bucket of buckets.values()) {
    const bucketHints = [bucket.hint, singleBucket ? override : null].filter(Boolean) as string[];

    // The town/address printed alongside this bucket's place — used both to
    // pick between same-named places and to file a brand-new one's region.
    const locCounts = new Map<string, number>();
    for (const e of bucket.events) {
      const l = (e as any).venue_location_hint?.trim();
      if (l) locCounts.set(l, (locCounts.get(l) ?? 0) + 1);
    }
    const locationHint =
      [...locCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? (singleBucket ? override : null);

    // 1. Strict match on the bucket's hints, disambiguated by town.
    let venue: VenueRow | null = null;
    for (const hint of bucketHints) {
      venue = await matchVenue(hint, locationHint);
      if (venue) break;
    }

    // 2. Swap detection: if a title in this bucket matches an existing
    // place, use it and give those events the hint as title.
    if (!venue) {
      for (const e of bucket.events) {
        const tNorm = norm(e.title);
        if (tNorm.length < 6) continue;
        const cands = await findVenueCandidates(e.title, 5);
        const hit = cands.find((c) => {
          const cn = norm(c.name);
          return cn === tNorm || cn.startsWith(tNorm);
        });
        if (hit) {
          const { data: full } = await sb
            .from("venues")
            .select("id, name, slug, address, city_id, city:cities(slug)")
            .eq("id", hit.id)
            .maybeSingle();
          if (full) {
            venue = full as unknown as VenueRow;
            for (const ev of bucket.events) {
              if (norm(ev.title) === tNorm) {
                ev.title = bucketHints[0] ?? "Family event";
              }
            }
          }
          break;
        }
      }
    }

    // 3. No way to place this bucket at all → report, don't guess.
    if (!venue && bucketHints.length === 0) {
      unplaced.push(...bucket.events.map((e) => e.title));
      continue;
    }

    // 4. Place not on the site yet → create it UNAPPROVED, filed under
    // the region this bucket's poster address/postcode points at.
    let createdVenue = false;
    let citySure = true;
    if (!venue) {
      const name = bucketHints[0].trim().slice(0, 200);

      if (!citiesCache) {
        const { data: cities } = await sb.from("cities").select("id, slug, name");
        citiesCache = cities ?? [];
      }
      const loc = await resolveCityFromLocation(citiesCache, locationHint);
      citySure = loc.sure;

      const baseSlug = name.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9\s-]/g, "")
        .replace(/\s+/g, "-").replace(/-+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "venue";
      let slug = baseSlug;
      for (let i = 0; i < 6 && !venue; i++) {
        const { data: ins, error } = await sb
          .from("venues")
          .insert({
            name,
            slug,
            city_id: loc.cityId,
            address: locationHint?.replace(UK_POSTCODE_RE, "").replace(/[,\s]+$/, "").slice(0, 200) || null,
            postcode: loc.postcode,
            latitude: loc.lat,
            longitude: loc.lng,
            approved: false,
            // Event-host until an admin decides it's also a visitable place.
            venue_type: "programmes",
            auto_imported: true,
          })
          .select("id, name, slug, address, city_id, city:cities(slug)")
          .single();
        if (ins) { venue = ins as unknown as VenueRow; break; }
        if (error?.code === "23505") { slug = `${baseSlug}-${i + 2}`; continue; }
        return { ok: false, reason: "error", message: `Couldn't create place: ${error?.message ?? "unknown"}` };
      }
      if (!venue) return { ok: false, reason: "error", message: "Couldn't find a free slug for the new place." };
      createdVenue = true;
    }

    const candidates = createdVenue ? await findVenueCandidates(venue.name) : [];

    // Skip same-hour duplicates rather than double-listing.
    const hourKey = (iso: string) => {
      const t = new Date(iso);
      const pad = (n: number) => String(n).padStart(2, "0");
      return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}T${pad(t.getUTCHours())}`;
    };
    const { data: existing } = await sb
      .from("events")
      .select("id, start_time")
      .eq("venue_id", venue.id)
      .neq("status", "rejected");
    const takenHours = new Set((existing ?? []).map((e) => hourKey(e.start_time)));

    // A title that is just the place's own name isn't a title.
    for (const e of bucket.events) {
      if (norm(e.title) === norm(venue.name)) {
        const altHint = bucketHints.find((h) => norm(h) !== norm(venue!.name));
        e.title = altHint ?? "Family event";
      }
    }

    const fresh = bucket.events.filter((e) => !takenHours.has(hourKey(e.starts_at)));
    const skippedDuplicates = bucket.events
      .filter((e) => takenHours.has(hourKey(e.starts_at)))
      .map((e) => e.title);

    const base: EventImportVenueResult = {
      venueName: venue.name,
      venueId: venue.id,
      venueSlug: venue.slug ?? null,
      citySlug: (venue as any).city?.slug ?? null,
      createdVenue,
      citySure,
      candidates,
      created: [],
      skippedDuplicates,
    };

    if (fresh.length === 0) {
      results.push(base);
      continue;
    }

    const rows = fresh.map((e) => ({
      venue_id: venue!.id,
      title: e.title.trim().slice(0, 200),
      start_time: e.starts_at,
      end_time: e.ends_at ?? null,
      description: (e.description ?? "").trim().slice(0, 2000),
      // Always pending on Kids — the group's buttons are the review step.
      status: "pending",
      submitted_by: opts.submittedBy,
      auto_imported_from: "manual_upload",
      auto_import_confidence: e.confidence,
      // NEVER store the Telegram file URL — it embeds the bot token and
      // expires. Set after the poster persists to our storage below.
      auto_import_image_url: null as string | null,
      image_url: null as string | null,
    }));

    const { data: created, error: insErr } = await sb
      .from("events")
      .insert(rows)
      .select("id, title, start_time");
    if (insErr) return { ok: false, reason: "error", message: insErr.message };

    (created ?? []).forEach((c, i) => {
      allCreatedIds.push(c.id);
      const e = fresh[i];
      for (const slug of (e as any)?.categories ?? []) {
        const gid = genreSlugToId.get(slug);
        if (gid) genreLinks.push({ event_id: c.id, genre_id: gid });
      }
    });

    results.push({
      ...base,
      created: (created ?? []).map((c) => ({ id: c.id, title: c.title, startTime: c.start_time })),
    });
  }

  if (results.length === 0) {
    return { ok: false, reason: "no_venue_hint" };
  }

  // Persist the poster ONCE into our storage and stamp every created event.
  if (allCreatedIds.length > 0) {
    const stored = await uploadPosterFromUrl(sb, {
      sourceUrl: opts.imageUrl,
      eventId: allCreatedIds[0],
    });
    if ("ok" in stored) {
      await sb
        .from("events")
        .update({ image_url: stored.publicUrl, auto_import_image_url: stored.publicUrl })
        .in("id", allCreatedIds);
    } else {
      console.warn("[telegram-event-import] poster persist failed:", stored.error);
    }
  }

  // Kids uses the genres table as CATEGORIES (soft-play, outdoors…).
  if (genreLinks.length) await sb.from("event_genres").insert(genreLinks);

  return { ok: true, venues: results, unplaced };
}
