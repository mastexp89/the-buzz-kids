// "/event + photo" import for the Kids Telegram admin bot: run AI extraction
// on a poster (fun day, fete, holiday club…), work out which place it's for
// from the name printed on the poster, and create the events as PENDING so
// the admins group gets them back with one-tap Approve/Reject buttons.
//
// If the place isn't on the site yet it's created UNAPPROVED, filed under
// the region the poster's address/postcode points at, and the group gets a
// single "Approve place + events / Discard" card.

import { createServiceClient } from "@/lib/supabase/service";
import { extractEvents } from "@/lib/extraction";
import { uploadPosterFromUrl } from "@/lib/poster-storage";

export type EventImportOutcome =
  | {
      ok: true;
      venueName: string;
      venueId: string;
      venueSlug: string | null;
      citySlug: string | null;
      createdVenue: boolean;
      citySure: boolean;
      created: { id: string; title: string; startTime: string }[];
      skippedDuplicates: string[];
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

export async function importEventPoster(opts: {
  imageUrl: string;
  submittedBy: string;
  venueHintOverride?: string | null;
}): Promise<EventImportOutcome> {
  const sb = createServiceClient();

  const { data: genres } = await sb.from("genres").select("id, slug, name").order("name");

  let extraction;
  try {
    extraction = await extractEvents({
      venueName: "Unknown — read the venue name off the poster",
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

  const hintCounts = new Map<string, number>();
  for (const e of events) {
    const h = (e as any).venue_hint?.trim();
    if (h) hintCounts.set(h, (hintCounts.get(h) ?? 0) + 1);
  }
  const posterHint = [...hintCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  const override = (opts.venueHintOverride ?? "").replace(/\/\w+(@[\w_]+)?/g, "").trim() || null;
  const hints = [posterHint, override].filter(Boolean) as string[];
  if (hints.length === 0) return { ok: false, reason: "no_venue_hint" };

  let venue: any = null;
  for (const hint of hints) {
    const alphanumeric = hint.replace(/[^a-zA-Z0-9\s]/g, " ").trim();
    const firstWord =
      alphanumeric.replace(/^the\s+/i, "").split(/\s+/).find((w) => w.length >= 3) ??
      alphanumeric.slice(0, 5);
    const { data: candidates } = await sb
      .from("venues")
      .select("id, name, slug, city_id, city:cities(slug)")
      .eq("approved", true)
      .ilike("name", `%${firstWord.slice(0, 12).replace(/[%_]/g, "")}%`)
      .limit(20);
    const hintNorm = norm(hint);
    venue = (candidates ?? []).find((v: any) => {
      const vn = norm(v.name);
      return vn === hintNorm || (vn.length >= 4 && hintNorm.length >= 4 && (vn.includes(hintNorm) || hintNorm.includes(vn)));
    }) ?? null;
    if (venue) break;
  }

  let createdVenue = false;
  let citySure = true;
  if (!venue) {
    const name = hints[0].trim().slice(0, 200);

    const locCounts = new Map<string, number>();
    for (const e of events) {
      const l = (e as any).venue_location_hint?.trim();
      if (l) locCounts.set(l, (locCounts.get(l) ?? 0) + 1);
    }
    const locationHint =
      [...locCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? override ?? null;

    const { data: cities } = await sb.from("cities").select("id, slug, name");
    const loc = await resolveCityFromLocation(cities ?? [], locationHint);
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
        .select("id, name, slug, city_id, city:cities(slug)")
        .single();
      if (ins) { venue = ins; break; }
      if (error?.code === "23505") { slug = `${baseSlug}-${i + 2}`; continue; }
      return { ok: false, reason: "error", message: `Couldn't create place: ${error?.message ?? "unknown"}` };
    }
    if (!venue) return { ok: false, reason: "error", message: "Couldn't find a free slug for the new place." };
    createdVenue = true;
  }

  const venueSlug: string | null = venue.slug ?? null;
  const citySlug: string | null = (venue as any).city?.slug ?? null;

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

  const fresh = events.filter((e) => !takenHours.has(hourKey(e.starts_at)));
  const skippedDuplicates = events
    .filter((e) => takenHours.has(hourKey(e.starts_at)))
    .map((e) => e.title);
  if (fresh.length === 0) {
    return { ok: true, venueName: venue.name, venueId: venue.id, venueSlug, citySlug, createdVenue, citySure, created: [], skippedDuplicates };
  }

  const rows = fresh.map((e) => ({
    venue_id: venue.id,
    title: e.title.trim().slice(0, 200),
    start_time: e.starts_at,
    end_time: e.ends_at ?? null,
    description: (e.description ?? "").trim().slice(0, 2000),
    // Always pending on Kids — the group's buttons are the review step.
    status: "pending",
    submitted_by: opts.submittedBy,
    auto_imported_from: "manual_upload",
    auto_import_confidence: e.confidence,
    auto_import_image_url: opts.imageUrl,
    image_url: opts.imageUrl,
  }));

  const { data: created, error: insErr } = await sb
    .from("events")
    .insert(rows)
    .select("id, title, start_time");
  if (insErr) return { ok: false, reason: "error", message: insErr.message };
  if (!created?.length) return { ok: false, reason: "error", message: "No events created." };

  const stored = await uploadPosterFromUrl(sb, {
    sourceUrl: opts.imageUrl,
    eventId: created[0].id,
  });
  if ("ok" in stored) {
    await sb
      .from("events")
      .update({ image_url: stored.publicUrl, auto_import_image_url: stored.publicUrl })
      .in("id", created.map((c) => c.id));
  }

  // Kids uses the genres table as CATEGORIES (soft-play, outdoors…).
  const genreSlugToId = new Map((genres ?? []).map((g) => [g.slug, g.id]));
  const genreLinks: { event_id: string; genre_id: string }[] = [];
  fresh.forEach((e, i) => {
    const eventId = created[i]?.id;
    if (!eventId) return;
    for (const slug of e.categories ?? []) {
      const gid = genreSlugToId.get(slug);
      if (gid) genreLinks.push({ event_id: eventId, genre_id: gid });
    }
  });
  if (genreLinks.length) await sb.from("event_genres").insert(genreLinks);

  return {
    ok: true,
    venueName: venue.name,
    venueId: venue.id,
    venueSlug,
    citySlug,
    createdVenue,
    citySure,
    created: created.map((c) => ({ id: c.id, title: c.title, startTime: c.start_time })),
    skippedDuplicates,
  };
}
