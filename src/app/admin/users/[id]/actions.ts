"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { cleanupUserDataBeforeAuthDelete } from "@/lib/account-deletion";

async function requireAdmin() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { supabase, ok: false as const, currentUserId: null };
  const { data: profile } = await supabase
    .from("profiles").select("role").eq("id", user.id).single();
  return { supabase, ok: profile?.role === "admin", currentUserId: user.id };
}

export async function updateUserProfile(userId: string, formData: FormData) {
  const { supabase, ok } = await requireAdmin();
  if (!ok) return { error: "Not authorised." };

  const display_name = String(formData.get("display_name") ?? "").trim() || null;
  const role = String(formData.get("role") ?? "venue_owner");
  if (!["user", "venue_owner", "artist", "event_organiser", "admin"].includes(role)) {
    return { error: "Invalid role." };
  }

  const { error } = await supabase
    .from("profiles")
    .update({ display_name, role })
    .eq("id", userId);
  if (error) return { error: error.message };

  // Sync raw_user_meta_data.account_type so admin emails, queries and any
  // future logic that reads from auth metadata reflect the role admin
  // just set. Without this, a fan-converted-to-venue would still report
  // "fan" in the metadata even though the profile says venue_owner — same
  // drift bug we just fixed in the signup flow.
  const accountTypeForRole: Record<string, string | null> = {
    user: "fan",
    venue_owner: "venue",
    artist: "artist",
    event_organiser: "organiser",
    admin: null, // leave metadata alone — admin role is orthogonal to "account type"
  };
  const newAccountType = accountTypeForRole[role];
  if (newAccountType !== null) {
    const admin = createServiceClient();
    const { data: u } = await admin.auth.admin.getUserById(userId);
    const currentMeta = (u?.user?.user_metadata ?? {}) as Record<string, unknown>;
    await admin.auth.admin.updateUserById(userId, {
      user_metadata: { ...currentMeta, account_type: newAccountType },
    });
  }

  revalidatePath(`/admin/users/${userId}`);
  revalidatePath("/admin");
  return { ok: true };
}

/**
 * Search for unclaimed artist pages by name. Used by the admin "Assign to
 * existing artist" panel on the user detail page.
 *
 * Mirrors the matching logic of /dashboard/setup so an admin sees the same
 * candidates the user would see if they hit the setup wizard themselves.
 */
export type UnclaimedArtistMatch = {
  id: string;
  name: string;
  slug: string;
  image_url: string | null;
  recent_event_count: number;
};

export type SearchUnclaimedArtistsResult =
  | { error: string }
  | { results: UnclaimedArtistMatch[] };

export async function searchUnclaimedArtistsForUser(
  query: string,
): Promise<SearchUnclaimedArtistsResult> {
  const { ok } = await requireAdmin();
  if (!ok) return { error: "Not authorised." };

  const q = query.trim();
  if (q.length < 2) {
    return { results: [] };
  }

  const sb = createServiceClient();
  const norm = q
    .toLowerCase()
    .trim()
    .replace(/^the\s+/i, "")
    .replace(/[^a-z0-9]+/g, "");

  const qStripped = q.replace(/^the\s+/i, "").trim() || q;
  const { data: candidates } = await sb
    .from("artists")
    .select("id, name, slug, image_url")
    .is("claimed_by", null)
    .ilike("name", `%${qStripped.replace(/[%_]/g, "").slice(0, 60)}%`)
    .limit(20);

  const results = (candidates ?? []).filter((a: any) => {
    const an = a.name
      .toLowerCase()
      .trim()
      .replace(/^the\s+/i, "")
      .replace(/[^a-z0-9]+/g, "");
    if (an === norm) return true;
    if (norm.length >= 4 && an.length >= 4 && (an.includes(norm) || norm.includes(an))) return true;
    // Also accept partial-word matches when the query is shorter than 4 chars
    if (norm.length >= 3 && an.startsWith(norm)) return true;
    return false;
  });

  // Decorate with recent gig count
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

  return {
    results: results.map((a: any) => ({
      id: a.id,
      name: a.name,
      slug: a.slug,
      image_url: a.image_url,
      recent_event_count: counts.get(a.id) ?? 0,
    })),
  };
}

export type AssignArtistResult =
  | { error: string }
  | { ok: true; artistId: string; slug: string; name: string };

/**
 * Assign an existing (unclaimed) artist page to a user. If the user already
 * has a different artist page claimed, that one gets deleted so the user
 * ends up with exactly one — same model as /dashboard/setup uses.
 */
export async function assignArtistToUser(
  userId: string,
  artistId: string,
): Promise<AssignArtistResult> {
  const { ok } = await requireAdmin();
  if (!ok) return { error: "Not authorised." };

  const sb = createServiceClient();

  const { data: artist } = await sb
    .from("artists")
    .select("id, slug, name, claimed_by")
    .eq("id", artistId)
    .maybeSingle();
  if (!artist) return { error: "Artist not found." };
  if (artist.claimed_by && artist.claimed_by !== userId) {
    return { error: "That artist page is already claimed by someone else." };
  }

  // Drop any other auto-created artist for this user so they end up with
  // exactly one — matches the user-side claim flow.
  await sb.from("artists").delete().eq("claimed_by", userId).neq("id", artistId);

  const { error } = await sb
    .from("artists")
    .update({ claimed_by: userId, approved: true })
    .eq("id", artistId);
  if (error) return { error: error.message };

  revalidatePath(`/admin/users/${userId}`);
  revalidatePath("/admin");
  revalidatePath(`/artists/${artist.slug}`);
  revalidatePath("/artists");
  return { ok: true, artistId: artist.id, slug: artist.slug, name: artist.name };
}

export async function createArtistForUser(userId: string) {
  const { supabase, ok } = await requireAdmin();
  if (!ok) return { error: "Not authorised." };

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, display_name, email, role")
    .eq("id", userId)
    .maybeSingle();
  if (!profile) return { error: "User not found." };

  const name = (profile.display_name ?? profile.email ?? "Artist").trim();
  if (!name) return { error: "User has no display name or email to use." };

  const { data: existing } = await supabase
    .from("artists")
    .select("id")
    .eq("claimed_by", userId)
    .maybeSingle();
  if (existing) return { error: "User already has an artist page." };

  const baseSlug = name
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100) || "artist";

  const sb = createServiceClient();
  let slug = baseSlug;
  for (let i = 0; i < 6; i++) {
    const { data: created, error } = await sb
      .from("artists")
      .insert({
        name,
        slug,
        claimed_by: userId,
        approved: true,
      })
      .select("id, slug")
      .single();
    if (!error && created) {
      revalidatePath(`/admin/users/${userId}`);
      revalidatePath(`/artists/${created.slug}`);
      revalidatePath("/artists");
      return { ok: true, artistId: created.id, slug: created.slug };
    }
    if (error?.code === "23505") {
      slug = `${baseSlug}-${i + 2}`;
      continue;
    }
    return { error: error?.message ?? "Failed to create artist page." };
  }
  return { error: "Could not generate a unique slug." };
}

export type VenueAssignMatch = {
  id: string;
  name: string;
  slug: string;
  approved: boolean;
  cityName: string | null;
  citySlug: string | null;
  currentOwnerName: string | null;
  currentOwnerEmail: string | null;
  currentOwnerId: string | null;
};

export type SearchVenuesForAssignResult =
  | { error: string }
  | { results: VenueAssignMatch[] };

/**
 * Search venues by name for the admin "Assign to existing venue" panel.
 * Returns each match's current owner so the admin can see whose venue
 * they'd be transferring (existing reassignVenue flow does the write).
 */
export async function searchVenuesForAssign(
  query: string,
  excludeOwnerId?: string,
): Promise<SearchVenuesForAssignResult> {
  const { ok } = await requireAdmin();
  if (!ok) return { error: "Not authorised." };

  const q = query.trim();
  if (q.length < 2) return { results: [] };

  const sb = createServiceClient();
  // Strip leading "the " so admin can search "the X" and find "X" venues.
  const qStripped = q.replace(/^the\s+/i, "").trim() || q;
  const { data: candidates } = await sb
    .from("venues")
    .select("id, name, slug, approved, owner_id, city:cities(name, slug)")
    .ilike("name", `%${qStripped.replace(/[%_]/g, "").slice(0, 80)}%`)
    .order("name")
    .limit(20);

  const rows = (candidates ?? []).filter((v: any) =>
    excludeOwnerId ? v.owner_id !== excludeOwnerId : true,
  );

  // Look up current owner display info in one batch.
  const ownerIds = Array.from(
    new Set(rows.map((v: any) => v.owner_id).filter(Boolean) as string[]),
  );
  const ownerById = new Map<string, { name: string | null; email: string | null }>();
  if (ownerIds.length > 0) {
    const { data: owners } = await sb
      .from("profiles")
      .select("id, display_name, email")
      .in("id", ownerIds);
    for (const o of owners ?? []) {
      ownerById.set(o.id, { name: o.display_name ?? null, email: o.email ?? null });
    }
  }

  const results: VenueAssignMatch[] = rows.map((v: any) => ({
    id: v.id,
    name: v.name,
    slug: v.slug,
    approved: !!v.approved,
    cityName: v.city?.name ?? null,
    citySlug: v.city?.slug ?? null,
    currentOwnerId: v.owner_id ?? null,
    currentOwnerName: v.owner_id ? ownerById.get(v.owner_id)?.name ?? null : null,
    currentOwnerEmail: v.owner_id ? ownerById.get(v.owner_id)?.email ?? null : null,
  }));

  return { results };
}

export async function reassignVenue(venueId: string, newOwnerId: string) {
  const { supabase, ok } = await requireAdmin();
  if (!ok) return { error: "Not authorised." };

  const { data: target } = await supabase
    .from("profiles").select("id").eq("id", newOwnerId).maybeSingle();
  if (!target) return { error: "New owner not found." };

  const { error } = await supabase
    .from("venues")
    .update({ owner_id: newOwnerId })
    .eq("id", venueId);
  if (error) return { error: error.message };

  revalidatePath("/admin");
  return { ok: true };
}

export async function sendPasswordResetEmail(userId: string) {
  const { ok } = await requireAdmin();
  if (!ok) return { error: "Not authorised." };

  const admin = createServiceClient();
  const { data: u, error: lookupErr } = await admin.auth.admin.getUserById(userId);
  if (lookupErr || !u?.user?.email) {
    return { error: lookupErr?.message ?? "User has no email on file." };
  }
  const email = u.user.email;

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.thebuzzguide.co.uk";
  const { error } = await admin.auth.resetPasswordForEmail(email, {
    redirectTo: `${siteUrl}/auth/update-password`,
  });
  if (error) return { error: error.message };
  return { ok: true, email };
}

export async function forceSetUserPassword(userId: string, newPassword: string) {
  const { ok, currentUserId } = await requireAdmin();
  if (!ok) return { error: "Not authorised." };
  if (userId === currentUserId) {
    return { error: "Use Account settings to change your own password." };
  }
  if (typeof newPassword !== "string" || newPassword.length < 8) {
    return { error: "Password must be at least 8 characters." };
  }

  const admin = createServiceClient();
  const { error } = await admin.auth.admin.updateUserById(userId, {
    password: newPassword,
  });
  if (error) return { error: error.message };
  return { ok: true };
}

export async function deleteUserProfile(userId: string) {
  const { supabase, ok, currentUserId } = await requireAdmin();
  if (!ok) return { error: "Not authorised." };
  if (userId === currentUserId) return { error: "You can't delete yourself." };

  const { data: stillOwns } = await supabase
    .from("venues").select("id").eq("owner_id", userId).limit(1);
  if (stillOwns && stillOwns.length > 0) {
    return { error: "Reassign or delete this user's venues first." };
  }

  const admin = createServiceClient();

  // Clear every public.* row that references this user before calling auth
  // delete. Profile, claimed artists, suggestions, claims, messages — all
  // cleaned up so the auth.users delete isn't blocked by an FK constraint.
  try {
    await cleanupUserDataBeforeAuthDelete(admin, userId);
  } catch (err: any) {
    return { error: `Pre-delete cleanup failed: ${err?.message ?? err}` };
  }

  const { error: authErr } = await admin.auth.admin.deleteUser(userId);
  if (authErr) {
    if (!/not found|user not found/i.test(authErr.message)) {
      return { error: `Auth delete failed: ${authErr.message}` };
    }
  }

  revalidatePath("/admin");
  redirect("/admin");
}

// Generate a one-time magic-link sign-in URL for the target user. Admin opens it
// in an incognito window so their main admin session stays intact. The user is
// effectively logged in as themselves; admin sees what they see.
export async function generateImpersonationLink(userId: string) {
  const { ok } = await requireAdmin();
  if (!ok) return { error: "Not authorised." };

  const admin = createServiceClient();
  const { data: u, error: lookupErr } = await admin.auth.admin.getUserById(userId);
  if (lookupErr || !u?.user?.email) {
    return { error: lookupErr?.message ?? "User has no email on file." };
  }
  const email = u.user.email;

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.thebuzzguide.co.uk";
  const { data, error } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email,
    options: {
      redirectTo: `${siteUrl}/auth/magic-bridge`,
    },
  });
  if (error) return { error: error.message };
  const actionLink = (data as any)?.properties?.action_link as string | undefined;
  if (!actionLink) return { error: "Couldn't generate link." };

  return { ok: true, link: actionLink, email };
}
