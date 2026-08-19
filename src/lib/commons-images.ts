// Source venue photos from Wikimedia Commons — openly licensed (CC / public
// domain), so we can legally publish them, unlike images copied off a venue's
// own website (which are often licensed stock; one such image drew an Alamy
// claim). Every image records its licence + required credit.
//
// Strategy per venue, best relevance first:
//   1. Commons full-text search on the venue name (a photo actually OF it)
//   2. Geosearch around the venue's coordinates, nearest first
//
// CC BY / CC BY-SA REQUIRE visible attribution, so we store the photographer
// and licence and the UI renders them. Public-domain images need no credit but
// we keep the record anyway.

import sharp from "sharp";
import type { createServiceClient } from "@/lib/supabase/service";

const API = "https://commons.wikimedia.org/w/api.php";
// Commons asks for a descriptive UA identifying the app + contact.
const UA = "TheBuzzKidsBot/1.0 (https://thebuzzkids.co.uk; images@thebuzzkids.co.uk)";
const TIMEOUT = 15_000;
const MAX_WIDTH = 1400;

// Licences we'll publish. Anything else (non-commercial, no-derivatives,
// unknown) is skipped rather than risk another claim.
const OK_LICENCE = /^(cc[ -]by([ -]sa)?([ -][0-9.]+)?|cc0|public domain|pd)/i;

export type CommonsPhoto = {
  fileUrl: string;       // direct image URL
  descriptionUrl: string; // Commons file page (credit link)
  license: string;
  artist: string;
  title: string;
};

function stripHtml(s: string): string {
  return (s || "").replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
}

async function callApi(params: Record<string, string>): Promise<any> {
  const qs = new URLSearchParams({ format: "json", origin: "*", ...params });
  const res = await fetch(`${API}?${qs}`, {
    headers: { "User-Agent": UA },
    signal: AbortSignal.timeout(TIMEOUT),
  });
  if (!res.ok) throw new Error(`Commons ${res.status}`);
  return res.json();
}

// Turn API pages into usable, correctly-licensed photos.
function pickPhotos(json: any): CommonsPhoto[] {
  const pages = json?.query?.pages ? Object.values<any>(json.query.pages) : [];
  const out: CommonsPhoto[] = [];
  for (const p of pages) {
    const ii = p?.imageinfo?.[0];
    if (!ii) continue;
    const title: string = p.title ?? "";
    if (!/\.(jpe?g|png)/i.test(title)) continue;
    // Skip maps, diagrams, logos, crests — not a photo of the place.
    if (/(map|diagram|logo|crest|coat of arms|plan|chart|icon|flag)/i.test(title)) continue;
    const license = stripHtml(ii.extmetadata?.LicenseShortName?.value ?? "");
    if (!OK_LICENCE.test(license)) continue;
    const artist = stripHtml(ii.extmetadata?.Artist?.value ?? "") || "Unknown photographer";
    const fileUrl: string = ii.thumburl || ii.url;
    if (!fileUrl) continue;
    out.push({
      fileUrl,
      descriptionUrl: ii.descriptionurl ?? `https://commons.wikimedia.org/wiki/${encodeURIComponent(title)}`,
      license,
      artist: artist.slice(0, 120),
      title,
    });
  }
  return out;
}

const IIPROPS = { prop: "imageinfo", iiprop: "url|extmetadata", iiurlwidth: "1400" };

/** Find the most relevant openly-licensed Commons photo for a venue. */
export async function findCommonsPhoto(venue: {
  name: string;
  latitude: number | null;
  longitude: number | null;
}): Promise<CommonsPhoto | null> {
  // 1. Name search — most likely to be a photo of the actual place.
  try {
    const json = await callApi({
      action: "query",
      generator: "search",
      gsrsearch: `${venue.name} Scotland`,
      gsrnamespace: "6",
      gsrlimit: "10",
      ...IIPROPS,
    });
    const photos = pickPhotos(json);
    if (photos.length > 0) return photos[0];
  } catch { /* fall through to geosearch */ }

  // 2. Geosearch — a nearby photo (widening radius), ordered by distance.
  if (venue.latitude != null && venue.longitude != null) {
    for (const radius of ["1000", "3000", "8000"]) {
      try {
        const json = await callApi({
          action: "query",
          generator: "geosearch",
          ggscoord: `${venue.latitude}|${venue.longitude}`,
          ggsradius: radius,
          ggslimit: "16",
          ggsnamespace: "6",
          ...IIPROPS,
        });
        const photos = pickPhotos(json);
        if (photos.length > 0) return photos[0];
      } catch { /* try wider */ }
    }
  }
  return null;
}

export type LegalImageOutcome =
  | { ok: true; url: string; license: string; attribution: string; sourceUrl: string }
  | { ok: false; reason: string };

/** Fetch, normalise and re-host a Commons photo for one venue. */
export async function applyCommonsPhoto(
  sb: ReturnType<typeof createServiceClient>,
  venue: { id: string; name: string; latitude: number | null; longitude: number | null },
): Promise<LegalImageOutcome> {
  const photo = await findCommonsPhoto(venue);
  if (!photo) return { ok: false, reason: "no openly-licensed photo found" };

  let jpeg: Buffer;
  try {
    const res = await fetch(photo.fileUrl, {
      headers: { "User-Agent": UA },
      signal: AbortSignal.timeout(TIMEOUT),
    });
    if (!res.ok) return { ok: false, reason: `image fetch ${res.status}` };
    const buf = Buffer.from(await res.arrayBuffer());
    const meta = await sharp(buf).metadata();
    if ((meta.width ?? 0) < 400) return { ok: false, reason: "image too small" };
    jpeg = await sharp(buf)
      .rotate()
      .resize({ width: MAX_WIDTH, withoutEnlargement: true })
      .jpeg({ quality: 82, mozjpeg: true })
      .toBuffer();
  } catch (e: any) {
    return { ok: false, reason: `download failed (${e?.message ?? e})` };
  }

  const path = `venues/${venue.id}/cover.jpg`;
  const { error: upErr } = await sb.storage
    .from("media")
    .upload(path, jpeg, { contentType: "image/jpeg", upsert: true });
  if (upErr) return { ok: false, reason: `upload: ${upErr.message}` };

  const { data: pub } = sb.storage.from("media").getPublicUrl(path);
  return {
    ok: true,
    url: `${pub.publicUrl}?v=${Date.now()}`,
    license: photo.license,
    attribution: photo.artist,
    sourceUrl: photo.descriptionUrl,
  };
}

export type LegalBatchResult = {
  processed: number;
  swapped: number;
  remaining: number;
  failures: { name: string; reason: string }[];
};

/**
 * Replace risky website-harvested images with openly-licensed Commons photos.
 * Venues with no cover image at all are also filled. Processes oldest-first and
 * marks each attempt so repeat runs always advance.
 */
export async function legalImageBatch(
  sb: ReturnType<typeof createServiceClient>,
  limit = 10,
): Promise<LegalBatchResult> {
  const { data } = await sb
    .from("venues")
    .select("id, name, latitude, longitude")
    .eq("approved", true)
    .is("image_legal_attempt", null)
    .or("image_source.eq.website,cover_photo_url.is.null")
    .limit(limit);

  const rows = data ?? [];
  const failures: { name: string; reason: string }[] = [];
  let swapped = 0;

  // Sequential — Commons asks API clients not to hammer it in parallel.
  for (const v of rows as any[]) {
    let outcome: LegalImageOutcome;
    try {
      outcome = await applyCommonsPhoto(sb, v);
    } catch (e: any) {
      outcome = { ok: false, reason: e?.message ?? "error" };
    }
    const update: Record<string, unknown> = { image_legal_attempt: new Date().toISOString() };
    if (outcome.ok) {
      update.cover_photo_url = outcome.url;
      update.image_source = "commons";
      update.image_license = outcome.license;
      update.image_attribution = outcome.attribution;
      update.image_source_url = outcome.sourceUrl;
      swapped++;
    } else {
      failures.push({ name: v.name, reason: outcome.reason });
    }
    await sb.from("venues").update(update).eq("id", v.id);
  }

  const { count } = await sb
    .from("venues")
    .select("id", { count: "exact", head: true })
    .eq("approved", true)
    .is("image_legal_attempt", null)
    .or("image_source.eq.website,cover_photo_url.is.null");

  return { processed: rows.length, swapped, remaining: count ?? 0, failures };
}
