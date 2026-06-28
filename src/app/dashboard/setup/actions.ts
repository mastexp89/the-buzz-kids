"use server";

// Post-signup setup wizard for artists.
// Flow:
//   1. Search for unclaimed artists with a matching normalised name
//   2. Let them claim an existing one (sets claimed_by = current user)
//   3. Or create a new one — but double-check there's no unclaimed match
//      first, in case the user typed a slight variation
//
// Used to prevent duplicate artist pages when a band already has an
// unclaimed directory entry from being scraped or admin-imported.

import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { notifyNewArtist } from "@/lib/email";
import { revalidatePath } from "next/cache";

function normaliseName(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/^the\s+/i, "")
    .replace(/[^a-z0-9]+/g, "");
}

function slugifyName(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100);
}

export type UnclaimedArtistOption = {
  id: string;
  name: string;
  slug: string;
  image_url: string | null;
  recent_event_count: number;
};

export async function searchUnclaimedArtists(query: string): Promise<UnclaimedArtistOption[]> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];

  const q = query.trim();
  if (q.length < 2) return [];

  const sb = createServiceClient();
  const norm = normaliseName(q);

  // Pull a wide net by raw name match, then post-filter by normalised name.
  // First strip "the " so "the cherry bombz" still matches "Cherry Bombz",
  // then use the first significant alphanumeric word as the ilike pattern
  // so apostrophes / ampersands / punctuation differences between query
  // and stored name don't silently kill the match.
  const qStripped = q.replace(/^the\s+/i, "").trim() || q;
  const alphanumeric = qStripped.replace(/[^a-zA-Z0-9\s]/g, " ").trim();
  const firstWord =
    alphanumeric.split(/\s+/).find((w) => w.length >= 3) ||
    alphanumeric.slice(0, 5) ||
    qStripped;
  const ilikePattern = firstWord.slice(0, 8).replace(/[%_]/g, "");

  const { data: candidates } = await sb
    .from("artists")
    .select("id, name, slug, image_url")
    .is("claimed_by", null)
    .ilike("name", `%${ilikePattern}%`)
    .limit(30);

  const results = (candidates ?? []).filter((a: any) => {
    const an = normaliseName(a.name);
    if (an === norm) return true;
    if (norm.length >= 4 && an.length >= 4 && (an.includes(norm) || norm.includes(an))) return true;
    return false;
  });

  // Decorate with recent event count for context
  const ids = results.map((a: any) => a.id);
  const counts = new Map<string, number>();
  if (ids.length > 0) {
    const sinceIso = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
    const { data: links } = await sb
      .from("event_artists")
      .select("artist_id, event:events(start_time)")
      .in("artist_id", ids);
    for (const l of links ?? []) {
      const t = (l.event as any)?.start_time;
      if (t && t >= sinceIso) {
        counts.set(l.artist_id, (counts.get(l.artist_id) ?? 0) + 1);
      }
    }
  }

  return results.map((a: any) => ({
    id: a.id,
    name: a.name,
    slug: a.slug,
    image_url: a.image_url,
    recent_event_count: counts.get(a.id) ?? 0,
  }));
}

export type ClaimArtistResult =
  | { ok: true; slug: string }
  | { error: string };

export async function claimArtist(artistId: string): Promise<ClaimArtistResult> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };

  const sb = createServiceClient();

  // Block fans (role='user'). Page-level guard already redirects them
  // away from /dashboard/setup, but a forged POST would skip that.
  const { data: profile } = await sb
    .from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (!profile) return { error: "Profile missing." };
  if (profile.role === "user") {
    return {
      error:
        "You're signed up as a fan. To add an artist page, contact admin or create a new account choosing 'Artist / Band / DJ' at signup.",
    };
  }
  // Already-classified accounts who happen to be claiming an artist
  // (e.g. a venue owner who's also in a band) get promoted to 'artist'.
  // Admin role is left alone.
  if (profile.role !== "artist" && profile.role !== "admin") {
    await sb.from("profiles").update({ role: "artist" }).eq("id", user.id);
  }

  // Atomically claim — only succeeds if the artist isn't already claimed by
  // someone else
  const { data: artist } = await sb
    .from("artists")
    .select("id, slug, claimed_by")
    .eq("id", artistId)
    .maybeSingle();
  if (!artist) return { error: "Artist not found." };
  if (artist.claimed_by && artist.claimed_by !== user.id) {
    return { error: "That page has already been claimed by someone else. Refresh the list and try another." };
  }

  // Multi-band: users can claim multiple artist pages now. We DON'T delete
  // their other claimed artists when claiming a new one. (Previously we
  // wiped any auto-created artist to leave them with one — that's gone.)
  // Phase 3 approval gate: a claim drops the page back to approved=false
  // so admin re-verifies the new owner before it's publicly visible.
  const { error } = await sb
    .from("artists")
    .update({ claimed_by: user.id, approved: false })
    .eq("id", artistId);
  if (error) return { error: error.message };

  // Fetch the artist name for the notification email
  const { data: artistRow } = await sb
    .from("artists").select("name").eq("id", artistId).maybeSingle();
  notifyNewArtist({
    artistId,
    artistName: artistRow?.name ?? "Unknown artist",
    claimerEmail: user.email ?? null,
  }).catch(() => {});

  revalidatePath("/artists");
  revalidatePath(`/artists/${artist.slug}`);
  revalidatePath("/dashboard");
  return { ok: true, slug: artist.slug };
}

export type CreateNewArtistResult =
  | { ok: true; artistId: string; slug: string }
  | { conflicts: UnclaimedArtistOption[] }  // when similar unclaimed exists
  | { error: string };

export async function createNewArtistForMe(opts: {
  name: string;
  // When true, skips the duplicate check (admin override after seeing conflicts)
  forceCreate?: boolean;
}): Promise<CreateNewArtistResult> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };

  const name = opts.name.trim();
  if (name.length < 2) return { error: "Artist name must be at least 2 characters." };
  if (name.length > 120) return { error: "Artist name is too long (max 120)." };

  const sb = createServiceClient();

  // Block fans first; otherwise ensure they're tagged as an artist
  // (admin role is preserved).
  const { data: profile } = await sb
    .from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (profile?.role === "user") {
    return {
      error:
        "You're signed up as a fan. To add an artist page, contact admin or create a new account choosing 'Artist / Band / DJ' at signup.",
    };
  }
  if (profile?.role !== "artist" && profile?.role !== "admin") {
    await sb.from("profiles").update({ role: "artist" }).eq("id", user.id);
  }

  // Multi-band: a user can have many claimed artists, so we only short-
  // circuit if the SAME name is already one of theirs (otherwise it'd be
  // impossible to add a second band).
  const norm = normaliseName(name);
  const { data: existingMine } = await sb
    .from("artists")
    .select("id, slug, name")
    .eq("claimed_by", user.id);
  const sameNameAlreadyMine = (existingMine ?? []).find(
    (a: any) => normaliseName(a.name) === norm,
  );
  if (sameNameAlreadyMine) {
    return { ok: true, artistId: sameNameAlreadyMine.id, slug: sameNameAlreadyMine.slug };
  }

  // Dupe check: any unclaimed artist with similar normalised name?
  if (!opts.forceCreate) {
    const matches = await searchUnclaimedArtists(name);
    if (matches.length > 0) {
      return { conflicts: matches };
    }
  }

  // Generate unique slug. New artists go in pending (approved=false) so
  // admin reviews before the page goes public — same gate as venues +
  // organisers (Phase 3).
  const baseSlug = slugifyName(name) || "artist";
  let slug = baseSlug;
  let created: any = null;
  for (let i = 0; i < 8; i++) {
    const { data, error } = await sb
      .from("artists")
      .insert({ name, slug, claimed_by: user.id, approved: false })
      .select("id, slug")
      .single();
    if (!error && data) {
      created = data;
      break;
    }
    if ((error as any)?.code === "23505") {
      slug = `${baseSlug}-${i + 2}`;
      continue;
    }
    return { error: (error as any)?.message ?? "Couldn't create artist." };
  }
  if (!created) return { error: "Couldn't generate a unique URL slug." };

  notifyNewArtist({
    artistId: created.id,
    artistName: name,
    claimerEmail: user.email ?? null,
  }).catch(() => {});

  revalidatePath("/artists");
  revalidatePath("/dashboard");
  return { ok: true, artistId: created.id, slug: created.slug };
}

export type MyArtistsStatus =
  | null
  | {
      // List of every artist this user has claimed. Empty array means
      // first-time signup — wizard should encourage them to claim or
      // create. Multi-band: this can be 2+, all displayed in the
      // setup wizard's "Your bands so far" banner.
      claimed: Array<{ id: string; slug: string; name: string; image_url: string | null }>;
      suggestedName: string;
    };

/**
 * What artist pages does the signed-in user own? Used by /dashboard/setup
 * to render the "Your bands so far: X, Y, Z" banner and seed the search
 * box with their display name.
 */
export async function getMyArtistStatus(): Promise<MyArtistsStatus> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const sb = createServiceClient();
  const { data: artists } = await sb
    .from("artists")
    .select("id, slug, name, image_url")
    .eq("claimed_by", user.id)
    .order("name");

  const { data: profile } = await sb
    .from("profiles")
    .select("display_name")
    .eq("id", user.id)
    .maybeSingle();

  return {
    claimed: (artists ?? []).map((a: any) => ({
      id: a.id,
      slug: a.slug,
      name: a.name,
      image_url: a.image_url ?? null,
    })),
    suggestedName: profile?.display_name ?? "",
  };
}
