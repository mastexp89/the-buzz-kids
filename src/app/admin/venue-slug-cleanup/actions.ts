"use server";

// One-off cleanup for the 90 venues a batch import script stamped with
// random 6-char suffixes on 2026-05-05 (e.g. "the-gunners-bar-isx3pa").
// The script that did this isn't in the codebase anymore; new venues
// don't get suffixes. Tool strips the suffix where the clean slug is
// free, falls back to numbered "-2" / "-3" on real collisions, and
// inserts slug_redirects so old QR codes / inbound links still work.

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";

async function requireAdmin() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: me } = await supabase
    .from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (me?.role !== "admin") return null;
  return { userId: user.id };
}

// A suffix is "random" if it's exactly 6 chars of [a-z0-9] AND contains
// at least one digit. Real English words don't have digits, so this
// catches "isx3pa" / "pwhv1y" / "x34kt8" but skips "culdee" / "selkie".
const RANDOM_SUFFIX = /-([a-z0-9]{6})$/;
function stripRandomSuffix(slug: string): string | null {
  const m = slug.match(RANDOM_SUFFIX);
  if (!m) return null;
  if (!/[0-9]/.test(m[1])) return null; // word-like, leave alone
  return slug.replace(RANDOM_SUFFIX, "");
}

export type SuffixedVenue = {
  id: string;
  name: string;
  citySlug: string | null;
  currentSlug: string;
  proposedSlug: string;
  // "free" = proposed slug is available
  // "collision" = another venue already owns the clean slug
  status: "free" | "collision";
  collidesWith?: { id: string; name: string };
};

/**
 * Walks every venue, finds the ones with random suffixes, and decides
 * what each one's clean slug should be — either the stripped base
 * (when that's free) or base-2 / base-3 (when another venue already
 * owns base).
 */
export async function findSuffixedVenues(): Promise<
  | { ok: true; venues: SuffixedVenue[] }
  | { error: string }
> {
  if (!(await requireAdmin())) return { error: "Admins only." };
  const sb = createServiceClient();

  const { data: all } = await sb
    .from("venues")
    .select("id, name, slug, city:cities(slug)")
    .order("name");

  const suffixed: Array<{ id: string; name: string; slug: string; base: string; citySlug: string | null }> = [];
  const allSlugs = new Set<string>();
  for (const v of all ?? []) {
    allSlugs.add((v as any).slug);
    const base = stripRandomSuffix((v as any).slug as string);
    if (base) {
      suffixed.push({
        id: (v as any).id,
        name: (v as any).name,
        slug: (v as any).slug,
        base,
        citySlug: (v as any).city?.slug ?? null,
      });
    }
  }

  // Within the suffixed set, we'd also collide with each other if two
  // venues strip to the same base. Track which base each suffixed venue
  // wants — first claimant wins the clean base, others get -2 / -3.
  const baseClaimed = new Set<string>();
  const venues: SuffixedVenue[] = [];

  for (const v of suffixed) {
    // Does the clean base already exist in the venues table (in any other row)?
    const baseTakenByOther =
      allSlugs.has(v.base) && v.base !== v.slug;

    if (baseTakenByOther) {
      // Find the venue that owns it for context
      const winner = (all ?? []).find((x: any) => x.slug === v.base);
      venues.push({
        id: v.id,
        name: v.name,
        citySlug: v.citySlug,
        currentSlug: v.slug,
        proposedSlug: deriveAlt(v.base, allSlugs, baseClaimed),
        status: "collision",
        collidesWith: winner
          ? { id: (winner as any).id, name: (winner as any).name }
          : undefined,
      });
      continue;
    }

    if (baseClaimed.has(v.base)) {
      // Two suffixed venues both want the same base — sequence them.
      venues.push({
        id: v.id,
        name: v.name,
        citySlug: v.citySlug,
        currentSlug: v.slug,
        proposedSlug: deriveAlt(v.base, allSlugs, baseClaimed),
        status: "collision",
      });
      continue;
    }

    baseClaimed.add(v.base);
    venues.push({
      id: v.id,
      name: v.name,
      citySlug: v.citySlug,
      currentSlug: v.slug,
      proposedSlug: v.base,
      status: "free",
    });
  }

  return { ok: true, venues };
}

// Find a "-2" / "-3" suffix that's free across both existing slugs and
// already-claimed bases inside this batch.
function deriveAlt(
  base: string,
  allSlugs: Set<string>,
  claimed: Set<string>,
): string {
  for (let i = 2; i < 50; i++) {
    const candidate = `${base}-${i}`;
    if (!allSlugs.has(candidate) && !claimed.has(candidate)) {
      claimed.add(candidate);
      return candidate;
    }
  }
  // Vanishingly unlikely to hit — base + 50 collisions in a row.
  return base;
}

export type RenameResult =
  | { ok: true; newSlug: string }
  | { error: string };

/**
 * Apply a slug rename. Adds a slug_redirects row from the OLD slug to
 * the NEW slug so QR codes / shared links / Google's index still resolve
 * to the venue.
 */
export async function renameVenueSlug(
  venueId: string,
  newSlug: string,
): Promise<RenameResult> {
  if (!(await requireAdmin())) return { error: "Admins only." };
  const sb = createServiceClient();

  const { data: v } = await sb
    .from("venues")
    .select("id, slug, city:cities(slug)")
    .eq("id", venueId)
    .maybeSingle();
  if (!v) return { error: "Venue not found." };
  const oldSlug = (v as any).slug as string;
  const citySlug = (v as any).city?.slug as string | undefined;
  if (oldSlug === newSlug) return { ok: true, newSlug };

  // Make sure newSlug really is free.
  const { data: clash } = await sb
    .from("venues")
    .select("id")
    .eq("slug", newSlug)
    .maybeSingle();
  if (clash && (clash as any).id !== venueId) {
    return { error: `Slug "${newSlug}" is already used by another venue.` };
  }

  const { error: updErr } = await sb
    .from("venues")
    .update({ slug: newSlug })
    .eq("id", venueId);
  if (updErr) return { error: updErr.message };

  // Insert a redirect so inbound links to the old URL still resolve.
  // slug_redirects table is keyed by (resource_type, city_slug, old_slug).
  await sb
    .from("slug_redirects")
    .upsert(
      [
        {
          resource_type: "venue",
          city_slug: citySlug ?? null,
          old_slug: oldSlug,
          new_slug: newSlug,
        },
      ],
      { onConflict: "resource_type,city_slug,old_slug" },
    );

  // Re-point any existing redirects that aimed at the old slug at the new
  // slug, so we don't end up with multi-hop redirect chains.
  await sb
    .from("slug_redirects")
    .update({ new_slug: newSlug })
    .eq("resource_type", "venue")
    .eq("new_slug", oldSlug);

  revalidatePath("/admin/venue-slug-cleanup");
  if (citySlug) revalidatePath(`/${citySlug}`);
  return { ok: true, newSlug };
}

/**
 * Bulk rename all venues whose proposed slug is "free" (no collision).
 * Skips collisions — admin reviews those manually.
 */
export async function renameAllSafe(): Promise<
  { ok: true; renamed: number; skipped: number; errors: string[] }
> {
  const errors: string[] = [];
  let renamed = 0;
  let skipped = 0;

  const list = await findSuffixedVenues();
  if ("error" in list) {
    errors.push(list.error);
    return { ok: true, renamed, skipped, errors };
  }
  for (const v of list.venues) {
    if (v.status !== "free") {
      skipped += 1;
      continue;
    }
    const res = await renameVenueSlug(v.id, v.proposedSlug);
    if ("error" in res) errors.push(`${v.name}: ${res.error}`);
    else renamed += 1;
  }
  revalidatePath("/admin/venue-slug-cleanup");
  return { ok: true, renamed, skipped, errors };
}
