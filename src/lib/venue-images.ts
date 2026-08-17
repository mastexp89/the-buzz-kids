// Restore venue images WITHOUT Google.
//
// Why: Google hardened hotlink protection on lh3.googleusercontent.com
// place-photos — every stored google_photo_url now 403s (for browsers AND for
// Vercel's image optimizer), so ~1,500 venues render blank. Re-scraping Google
// is a dead end twice over: the fresh URLs are blocked the same way, and Places
// photos aren't licensed for us to store permanently anyway.
//
// So we source images we're actually allowed to keep, for free: the venue's own
// website (og:image / twitter:image / a large in-page image — the picture they
// publish to promote themselves), downloaded once and re-hosted in our own
// Supabase bucket so it can never expire or be blocked again.
//
// Writes to cover_photo_url, which already outranks google_photo_url in
// PlaceCard, so a restored venue fixes itself with no UI change.

import sharp from "sharp";
import type { createServiceClient } from "@/lib/supabase/service";

// We identify honestly first. Plenty of venue sites (Glamis, ODEON, National
// Trust, Historic Scotland…) sit behind WAFs that blanket-403 anything with
// "bot" in the UA, so when we're refused we retry once as a normal browser —
// we're only reading the public homepage to show the venue's own promo image
// and link back to them.
const UA = "Mozilla/5.0 (compatible; TheBuzzBot/1.0; +https://thebuzzkids.co.uk)";
const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const BLOCKED_STATUSES = new Set([401, 403, 405, 406, 429, 503]);
const FETCH_TIMEOUT_MS = 12_000;
const MIN_BYTES = 3_000;      // smaller than this is a logo/spacer, not a photo
const MAX_WIDTH = 1400;

export type RestoreOutcome =
  | { ok: true; url: string; source: string }
  | { ok: false; reason: string };

function abs(src: string, base: string): string | null {
  try { return new URL(src, base).toString(); } catch { return null; }
}

// Pick the best candidate image URL from a page's HTML, best-first.
function candidateImages(html: string, baseUrl: string): string[] {
  const out: string[] = [];
  const push = (u: string | null | undefined) => {
    if (!u) return;
    const a = abs(u, baseUrl);
    if (!a || out.includes(a)) return;
    // Skip obvious non-photos.
    if (/\.(svg|gif|ico)(\?|$)/i.test(a)) return;
    if (/(sprite|logo|icon|placeholder|pixel|spacer|badge|banner-ad)/i.test(a)) return;
    out.push(a);
  };

  // 1. og:image / twitter:image — the picture the site itself promotes with.
  for (const re of [
    /<meta[^>]+property=["']og:image(?::url)?["'][^>]+content=["']([^"']+)["']/gi,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image(?::url)?["']/gi,
    /<meta[^>]+name=["']twitter:image(?::src)?["'][^>]+content=["']([^"']+)["']/gi,
  ]) {
    for (const m of html.matchAll(re)) push(m[1]);
  }

  // 2. JSON-LD "image" values.
  for (const m of html.matchAll(/"image"\s*:\s*"([^"]+)"/gi)) push(m[1]);

  // 3. Large in-page images — many small-business sites have no OG tags at all.
  for (const m of html.matchAll(/<img[^>]+>/gi)) {
    const tag = m[0];
    const src =
      /(?:data-src|data-lazy-src|src)=["']([^"']+)["']/i.exec(tag)?.[1] ??
      /srcset=["']([^"'\s,]+)/i.exec(tag)?.[1];
    push(src);
  }
  return out.slice(0, 12);
}

async function attempt(url: string, as: "text" | "buffer", ua: string): Promise<Response> {
  return fetch(url, {
    headers: {
      "User-Agent": ua,
      Accept:
        as === "text"
          ? "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
          : "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
      "Accept-Language": "en-GB,en;q=0.9",
    },
    redirect: "follow",
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
}

async function get(url: string, as: "text" | "buffer"): Promise<any> {
  let res: Response;
  try {
    res = await attempt(url, as, UA);
  } catch {
    res = await attempt(url, as, BROWSER_UA); // network-level block — try once more
  }
  if (!res.ok && BLOCKED_STATUSES.has(res.status)) {
    res = await attempt(url, as, BROWSER_UA);
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  if (as === "text") return { body: await res.text(), finalUrl: res.url };
  return { body: Buffer.from(await res.arrayBuffer()), type: res.headers.get("content-type") ?? "" };
}

/**
 * Find, download, normalise and re-host a venue's own image.
 * Returns the permanent public URL, or a reason it couldn't.
 */
export async function restoreVenueImage(
  sb: ReturnType<typeof createServiceClient>,
  venue: { id: string; slug: string; website: string | null },
): Promise<RestoreOutcome> {
  if (!venue.website || !/^https?:\/\//.test(venue.website)) {
    return { ok: false, reason: "no website" };
  }

  let html: string, finalUrl: string;
  try {
    const r = await get(venue.website, "text");
    html = r.body; finalUrl = r.finalUrl;
  } catch (e: any) {
    return { ok: false, reason: `site unreachable (${e?.message ?? e})` };
  }

  const candidates = candidateImages(html, finalUrl);
  if (candidates.length === 0) return { ok: false, reason: "no image on site" };

  for (const url of candidates) {
    try {
      const { body, type } = await get(url, "buffer");
      if (body.length < MIN_BYTES) continue;
      if (type && !/^image\//i.test(type)) continue;

      // Normalise to a sane JPEG — kills huge hero PNGs and strips EXIF.
      const meta = await sharp(body).metadata();
      if ((meta.width ?? 0) < 400 || (meta.height ?? 0) < 260) continue; // too small = logo
      const jpeg = await sharp(body)
        .rotate()
        .resize({ width: MAX_WIDTH, withoutEnlargement: true })
        .jpeg({ quality: 82, mozjpeg: true })
        .toBuffer();

      const path = `venues/${venue.id}/cover.jpg`;
      const { error: upErr } = await sb.storage
        .from("media")
        .upload(path, jpeg, { contentType: "image/jpeg", upsert: true });
      if (upErr) return { ok: false, reason: `upload: ${upErr.message}` };

      const { data: pub } = sb.storage.from("media").getPublicUrl(path);
      // Cache-bust so a re-run replaces the old file in browsers/CDN.
      const publicUrl = `${pub.publicUrl}?v=${Date.now()}`;
      return { ok: true, url: publicUrl, source: url };
    } catch {
      continue; // try the next candidate
    }
  }
  return { ok: false, reason: "no usable image" };
}

export type RestoreBatchResult = {
  processed: number;
  restored: number;
  remaining: number;
  failures: { name: string; reason: string }[];
};

/**
 * One batch of venues that are missing a working image. Venues are marked as
 * attempted either way so repeated runs always move forward.
 */
export async function restoreImageBatch(
  sb: ReturnType<typeof createServiceClient>,
  limit = 12,
): Promise<RestoreBatchResult> {
  const { data } = await sb
    .from("venues")
    .select("id, name, slug, website")
    .eq("approved", true)
    .is("cover_photo_url", null)
    .is("image_restore_attempt", null)
    .not("website", "is", null)
    .limit(limit);

  const rows = data ?? [];
  const failures: { name: string; reason: string }[] = [];
  let restored = 0;

  await Promise.all(
    rows.map(async (v: any) => {
      let outcome: RestoreOutcome;
      try {
        outcome = await restoreVenueImage(sb, v);
      } catch (e: any) {
        outcome = { ok: false, reason: e?.message ?? "error" };
      }
      const update: Record<string, unknown> = { image_restore_attempt: new Date().toISOString() };
      if (outcome.ok) {
        update.cover_photo_url = outcome.url;
        restored++;
      } else {
        failures.push({ name: v.name, reason: outcome.reason });
      }
      await sb.from("venues").update(update).eq("id", v.id);
    }),
  );

  const { count } = await sb
    .from("venues")
    .select("id", { count: "exact", head: true })
    .eq("approved", true)
    .is("cover_photo_url", null)
    .is("image_restore_attempt", null)
    .not("website", "is", null);

  return { processed: rows.length, restored, remaining: count ?? 0, failures };
}
