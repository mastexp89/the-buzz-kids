// Persists an event poster image into Supabase Storage so it stays alive
// even after the original FB CDN URL expires.
//
// Also auto-trims solid black borders / letterboxing off posters before
// upload, since Facebook frequently pads landscape posters with black bars.

import type { SupabaseClient } from "@supabase/supabase-js";
import sharp from "sharp";

const STORAGE_BUCKET = "media";
const POSTER_FOLDER = "event-posters";

const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

export type UploadResult =
  | { ok: true; publicUrl: string; path: string; trimmed: boolean }
  | { error: string };

export async function uploadPosterFromUrl(
  sb: SupabaseClient,
  opts: { sourceUrl: string; eventId: string; trim?: boolean },
): Promise<UploadResult> {
  if (!opts.sourceUrl) return { error: "No source URL." };

  let res: Response;
  try {
    res = await fetch(opts.sourceUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; TheBuzzBot/1.0; +https://www.thebuzzguide.co.uk)",
        Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
      },
    });
  } catch (e: any) {
    return { error: `fetch failed: ${e?.message ?? e}` };
  }
  if (!res.ok) return { error: `fetch ${res.status}` };

  const contentType =
    res.headers.get("content-type")?.split(";")[0].trim() || "image/jpeg";
  if (!ALLOWED_TYPES.has(contentType)) {
    return { error: `unsupported content type: ${contentType}` };
  }

  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length === 0) return { error: "empty body" };
  if (buf.length > 10 * 1024 * 1024) {
    return { error: `too large (${(buf.length / 1024 / 1024).toFixed(1)}MB)` };
  }

  let finalBuf: Buffer = buf;
  let finalContentType = contentType;
  let trimmed = false;
  if (opts.trim !== false) {
    try {
      const result = await trimSolidBorders(buf);
      if (result) {
        finalBuf = result.buffer as Buffer;
        finalContentType = "image/jpeg";
        trimmed = result.trimmed;
      }
    } catch (e: any) {
      console.warn("[poster-storage] trim failed, using original:", e?.message ?? e);
    }
  }

  const ext = mimeToExt(finalContentType);
  const path = `${POSTER_FOLDER}/${opts.eventId}.${ext}`;

  const { error: upErr } = await sb.storage
    .from(STORAGE_BUCKET)
    .upload(path, finalBuf, {
      upsert: true,
      cacheControl: "31536000",
      contentType: finalContentType,
    });
  if (upErr) return { error: `storage upload: ${upErr.message}` };

  const { data } = sb.storage.from(STORAGE_BUCKET).getPublicUrl(path);
  const publicUrl = `${data.publicUrl}?v=${Date.now()}`;
  return { ok: true, publicUrl, path, trimmed };
}

export async function trimSolidBorders(
  buf: Buffer,
): Promise<{ buffer: Buffer; trimmed: boolean } | null> {
  try {
    const meta = await sharp(buf).metadata();
    if (!meta.width || !meta.height) return null;

    let trimBuf: Buffer;
    let trimMeta: sharp.Metadata;
    try {
      trimBuf = (await sharp(buf)
        .trim({ threshold: 12 })
        .jpeg({ quality: 88, mozjpeg: true })
        .toBuffer()) as Buffer;
      trimMeta = await sharp(trimBuf).metadata();
    } catch {
      const passthrough = (await sharp(buf)
        .jpeg({ quality: 88, mozjpeg: true })
        .toBuffer()) as Buffer;
      return { buffer: passthrough, trimmed: false };
    }

    const widthChange = (meta.width - (trimMeta.width ?? meta.width)) / meta.width;
    const heightChange = (meta.height - (trimMeta.height ?? meta.height)) / meta.height;
    const wasTrimmed = widthChange > 0.005 || heightChange > 0.005;
    return { buffer: trimBuf, trimmed: wasTrimmed };
  } catch {
    return null;
  }
}

function mimeToExt(mime: string): string {
  switch (mime) {
    case "image/jpeg": return "jpg";
    case "image/png":  return "png";
    case "image/webp": return "webp";
    case "image/gif":  return "gif";
    default:           return "jpg";
  }
}

export function isPersistedPosterUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  return /\/storage\/v1\/object\/public\/media\/event-posters\//.test(url);
}

export async function retrimExistingPoster(
  sb: SupabaseClient,
  opts: { storedUrl: string; eventId: string },
): Promise<UploadResult> {
  if (!isPersistedPosterUrl(opts.storedUrl)) {
    return { error: "Not a persisted poster URL." };
  }
  const cleanUrl = opts.storedUrl.split("?")[0];
  return uploadPosterFromUrl(sb, {
    sourceUrl: cleanUrl,
    eventId: opts.eventId,
    trim: true,
  });
}
