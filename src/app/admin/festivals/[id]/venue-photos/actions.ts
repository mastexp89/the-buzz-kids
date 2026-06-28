"use server";

// Bulk venue cover-photo entry for a festival.
// Lists every venue linked to the festival; admin pastes an image URL per
// venue (e.g. their FB profile picture URL) and we download + persist it
// to our storage bucket as the venue's cover_photo_url.

import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { revalidatePath } from "next/cache";

const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const MAX_BYTES = 10 * 1024 * 1024;

async function requireAdmin() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: prof } = await supabase
    .from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (prof?.role !== "admin") return null;
  return { userId: user.id };
}

export type FestivalVenuePhotoRow = {
  id: string;
  name: string;
  slug: string;
  city: string | null;
  cover_photo_url: string | null;
  logo_url: string | null;
  facebook: string | null;
  website: string | null;
};

export async function listFestivalVenuePhotos(festivalId: string): Promise<FestivalVenuePhotoRow[]> {
  if (!(await requireAdmin())) return [];
  const sb = createServiceClient();
  const { data } = await sb
    .from("festival_venues")
    .select("sort_order, venues(id, name, slug, cover_photo_url, logo_url, facebook, website, city:cities(name))")
    .eq("festival_id", festivalId)
    .order("sort_order");
  return (data ?? []).map((r: any) => ({
    id: r.venues.id,
    name: r.venues.name,
    slug: r.venues.slug,
    city: r.venues.city?.name ?? null,
    cover_photo_url: r.venues.cover_photo_url,
    logo_url: r.venues.logo_url,
    facebook: r.venues.facebook,
    website: r.venues.website,
  }));
}

export type SetCoverFromUrlResult =
  | { ok: true; publicUrl: string; venueId: string }
  | { error: string; venueId: string };

export async function setVenueCoverFromUrl(opts: {
  venueId: string;
  url: string;
}): Promise<SetCoverFromUrlResult> {
  const ctx = await requireAdmin();
  if (!ctx) return { error: "Admins only.", venueId: opts.venueId };

  const cleaned = opts.url.trim();
  if (!cleaned) return { error: "Paste a URL first.", venueId: opts.venueId };
  let parsed: URL;
  try {
    parsed = new URL(cleaned);
  } catch {
    return { error: "Invalid URL.", venueId: opts.venueId };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { error: "URL must be http(s).", venueId: opts.venueId };
  }

  // Browser-like UA + Referer so FB / hotlink-protected CDNs don't 403
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
    return { error: `Fetch failed: ${e?.message ?? "network error"}`, venueId: opts.venueId };
  }
  if (!res.ok) return { error: `HTTP ${res.status} from source`, venueId: opts.venueId };

  const ct = (res.headers.get("content-type") ?? "").split(";")[0].trim();
  const path = parsed.pathname.toLowerCase();
  const fallbackType =
    path.endsWith(".jpg") || path.endsWith(".jpeg") ? "image/jpeg" :
    path.endsWith(".png") ? "image/png" :
    path.endsWith(".webp") ? "image/webp" :
    path.endsWith(".gif") ? "image/gif" : null;
  const mediaType = ALLOWED_TYPES.has(ct) ? ct : (fallbackType ?? "");
  if (!mediaType) return { error: `Unsupported type (${ct || "unknown"})`, venueId: opts.venueId };

  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length === 0) return { error: "Empty image", venueId: opts.venueId };
  if (buf.length > MAX_BYTES) {
    return { error: `Too big (${(buf.length / 1024 / 1024).toFixed(1)} MB)`, venueId: opts.venueId };
  }

  const sb = createServiceClient();
  const ext = mediaType === "image/jpeg" ? "jpg"
    : mediaType === "image/png" ? "png"
    : mediaType === "image/webp" ? "webp"
    : mediaType === "image/gif" ? "gif"
    : "jpg";
  const storagePath = `venues/${opts.venueId}/cover-${Date.now()}.${ext}`;
  const { error: upErr } = await sb.storage.from("media").upload(storagePath, buf, {
    contentType: mediaType,
    upsert: true,
    cacheControl: "3600",
  });
  if (upErr) return { error: `Upload failed: ${upErr.message}`, venueId: opts.venueId };
  const { data } = sb.storage.from("media").getPublicUrl(storagePath);

  // Persist on the venue record
  const { error: updErr } = await sb
    .from("venues")
    .update({
      cover_photo_url: data.publicUrl,
      cover_photo_last_attempt: new Date().toISOString(),
    })
    .eq("id", opts.venueId);
  if (updErr) return { error: `Saved file but DB update failed: ${updErr.message}`, venueId: opts.venueId };

  // Revalidate every page that shows venue cards / images so the new photo
  // appears site-wide without waiting for the page cache to expire.
  const { data: vRow } = await sb.from("venues").select("slug, city:cities(slug)").eq("id", opts.venueId).maybeSingle();
  const citySlug = (vRow?.city as any)?.slug ?? "dundee";
  if (vRow?.slug) revalidatePath(`/${citySlug}/venues/${vRow.slug}`);
  revalidatePath(`/${citySlug}`);  // city venue list / browse
  revalidatePath("/");              // homepage spotlight
  // Any festival this venue is part of — revalidate each
  const { data: festivalLinks } = await sb
    .from("festival_venues")
    .select("festival:festivals(slug)")
    .eq("venue_id", opts.venueId);
  for (const link of festivalLinks ?? []) {
    const fSlug = (link.festival as any)?.slug;
    if (fSlug) revalidatePath(`/festivals/${fSlug}`);
  }

  return { ok: true, publicUrl: data.publicUrl, venueId: opts.venueId };
}

export async function clearVenueCoverPhoto(venueId: string): Promise<{ ok: true } | { error: string }> {
  if (!(await requireAdmin())) return { error: "Admins only." };
  const sb = createServiceClient();
  const { error } = await sb.from("venues").update({ cover_photo_url: null }).eq("id", venueId);
  if (error) return { error: error.message };
  return { ok: true };
}
