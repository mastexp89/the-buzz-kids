"use server";

// Server action: download an image from a remote URL, persist it to our
// Supabase Storage bucket, return the public URL. Used by ImageUploader so
// admins can paste an FB / website image URL instead of saving the file
// locally first. Avoids browser CORS by doing the fetch server-side.

import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";

const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const MAX_BYTES = 10 * 1024 * 1024; // 10 MB

export type UploadFromUrlResult =
  | { ok: true; publicUrl: string }
  | { error: string };

export async function uploadImageFromUrl(opts: {
  folder: "venues" | "events" | "artists" | "festivals" | "sponsors";
  url: string;
}): Promise<UploadFromUrlResult> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };

  const cleaned = opts.url.trim();
  if (!cleaned) return { error: "Paste an image URL first." };
  let parsed: URL;
  try {
    parsed = new URL(cleaned);
  } catch {
    return { error: "That doesn't look like a valid URL." };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { error: "URL must be http(s)." };
  }

  // Fetch with a real browser UA so FB CDN / hotlink-protected sources don't 403
  let res: Response;
  try {
    res = await fetch(cleaned, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        Accept: "image/avif,image/webp,image/png,image/*,*/*;q=0.8",
        Referer: parsed.origin,
      },
      redirect: "follow",
    });
  } catch (e: any) {
    return { error: `Couldn't fetch the image: ${e?.message ?? "network error"}` };
  }
  if (!res.ok) return { error: `Source returned HTTP ${res.status}` };

  const ct = (res.headers.get("content-type") ?? "").split(";")[0].trim();
  // Some CDNs return application/octet-stream; sniff by extension as a fallback
  const fallbackType = (() => {
    const path = parsed.pathname.toLowerCase();
    if (path.endsWith(".jpg") || path.endsWith(".jpeg")) return "image/jpeg";
    if (path.endsWith(".png")) return "image/png";
    if (path.endsWith(".webp")) return "image/webp";
    if (path.endsWith(".gif")) return "image/gif";
    return null;
  })();
  const mediaType = ALLOWED_TYPES.has(ct) ? ct : (fallbackType ?? "");
  if (!mediaType) {
    return { error: `Unsupported image type (${ct || "unknown"}).` };
  }

  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length === 0) return { error: "Source returned an empty file." };
  if (buf.length > MAX_BYTES) {
    return { error: `Image too large (${(buf.length / 1024 / 1024).toFixed(1)} MB > 10 MB).` };
  }

  // Upload via service role (admin-uploaded images don't need to respect
  // the user's own RLS path constraints — we still scope by user id below).
  const sb = createServiceClient();
  const ext = mediaType === "image/jpeg" ? "jpg"
    : mediaType === "image/png" ? "png"
    : mediaType === "image/webp" ? "webp"
    : mediaType === "image/gif" ? "gif"
    : "jpg";
  const path = `${opts.folder}/${user.id}/from-url-${Date.now()}.${ext}`;
  const { error: upErr } = await sb.storage.from("media").upload(path, buf, {
    contentType: mediaType,
    upsert: false,
    cacheControl: "3600",
  });
  if (upErr) return { error: `Upload failed: ${upErr.message}` };
  const { data } = sb.storage.from("media").getPublicUrl(path);
  return { ok: true, publicUrl: data.publicUrl };
}
