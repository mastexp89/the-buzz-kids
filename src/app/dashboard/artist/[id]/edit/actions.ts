"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";

export type UpdateArtistResult = { ok: true; slug?: string } | { error: string };

const ALLOWED_FIELDS = [
  "name",
  "bio",
  "image_url",
  "website",
  "instagram",
  "facebook",
  "twitter",
  "tiktok",
  "spotify",
  "bandcamp",
  "youtube",
] as const;

// Slug is admin-only and routed via a separate field — changing it breaks
// any external links to the old URL.
const ADMIN_ONLY_FIELDS = ["slug"] as const;

function cleanSlug(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100);
}

export async function updateArtist(
  artistId: string,
  patch: Partial<Record<(typeof ALLOWED_FIELDS)[number] | (typeof ADMIN_ONLY_FIELDS)[number], string | null>>,
): Promise<UpdateArtistResult> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };

  // Permission check: claimer or admin
  const [{ data: artist }, { data: profile }] = await Promise.all([
    supabase
      .from("artists")
      .select("id, slug, claimed_by")
      .eq("id", artistId)
      .maybeSingle(),
    supabase.from("profiles").select("role").eq("id", user.id).maybeSingle(),
  ]);
  if (!artist) return { error: "Artist not found." };
  const isAdmin = profile?.role === "admin";
  const isClaimer = artist.claimed_by === user.id;
  if (!isAdmin && !isClaimer) return { error: "Not authorised." };

  // Whitelist + sanitise the patch
  const cleaned: Record<string, string | null> = {};
  for (const k of ALLOWED_FIELDS) {
    if (k in patch) {
      const v = patch[k];
      if (typeof v === "string") {
        const trimmed = v.trim();
        cleaned[k] = trimmed.length === 0 ? null : trimmed;
      } else if (v === null) {
        cleaned[k] = null;
      }
    }
  }

  // Slug change — admin only. Validate format + uniqueness.
  let newSlug: string | null = null;
  if ("slug" in patch && patch.slug !== undefined && patch.slug !== null) {
    if (!isAdmin) return { error: "Only admins can change the URL slug." };
    const proposed = cleanSlug(String(patch.slug));
    if (!proposed || proposed.length < 2) return { error: "Slug must be at least 2 characters." };
    if (proposed !== artist.slug) {
      // Use service client for the uniqueness check (RLS-safe)
      const sb = createServiceClient();
      const { data: clash } = await sb
        .from("artists")
        .select("id")
        .eq("slug", proposed)
        .neq("id", artistId)
        .maybeSingle();
      if (clash) return { error: `Slug "${proposed}" is already taken by another artist.` };
      cleaned.slug = proposed;
      newSlug = proposed;
    }
  }

  if (Object.keys(cleaned).length === 0) return { ok: true };

  const { error } = await supabase
    .from("artists")
    .update(cleaned)
    .eq("id", artistId);
  if (error) return { error: error.message };

  // Record a redirect so the old URL still works. Done as a side effect
  // after the update succeeds — failing to insert the redirect doesn't fail
  // the slug change itself, just logs.
  if (newSlug && newSlug !== artist.slug) {
    const sb = createServiceClient();
    // First, unify any existing redirects that pointed at the OLD slug —
    // re-target them at the NEW slug so we don't get redirect chains.
    await sb
      .from("slug_redirects")
      .update({ new_slug: newSlug })
      .eq("resource_type", "artist")
      .eq("new_slug", artist.slug);
    // Insert the redirect for the slug we just changed
    await sb.from("slug_redirects").upsert(
      { resource_type: "artist", city_slug: null, old_slug: artist.slug, new_slug: newSlug },
      { onConflict: "resource_type,city_slug,old_slug" },
    );
    // Drop any redirect that points TO the new slug from the new slug itself
    // (would be an infinite loop — shouldn't normally happen but defensive).
    await sb
      .from("slug_redirects")
      .delete()
      .eq("resource_type", "artist")
      .eq("old_slug", newSlug);
  }

  // Revalidate both old and new slug paths so the change shows up immediately
  revalidatePath(`/artists/${artist.slug}`);
  if (newSlug && newSlug !== artist.slug) revalidatePath(`/artists/${newSlug}`);
  revalidatePath(`/dashboard/artist/${artistId}/edit`);
  revalidatePath("/artists");
  return { ok: true, slug: newSlug ?? artist.slug };
}
