"use server";

// Post-signup setup wizard for event organisers.
// Mirrors /dashboard/setup (artists) and /dashboard/venue-setup —
// search the directory for an existing matching organiser first, claim
// if found, otherwise create new. Both paths set approved=false so admin
// reviews the first claim/create before the page goes public.

import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { notifyNewOrganiser } from "@/lib/email";
import { revalidatePath } from "next/cache";

function normaliseName(s: string): string {
  return s
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

export type UnclaimedOrganiserOption = {
  id: string;
  name: string;
  slug: string;
  bio: string | null;
  imageUrl: string | null;
};

export async function searchUnclaimedOrganisers(query: string): Promise<UnclaimedOrganiserOption[]> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];
  const q = query.trim();
  if (q.length < 2) return [];

  const sb = createServiceClient();
  const norm = normaliseName(q);
  // Strip leading "the", then use first significant alphanumeric word as
  // the ilike pattern so apostrophes / ampersands / punctuation
  // differences don't silently kill the match (matches venue/artist
  // search behaviour).
  const qStripped = q.replace(/^the\s+/i, "").trim() || q;
  const alphanumeric = qStripped.replace(/[^a-zA-Z0-9\s]/g, " ").trim();
  const firstWord =
    alphanumeric.split(/\s+/).find((w) => w.length >= 3) ||
    alphanumeric.slice(0, 5) ||
    qStripped;
  const ilikePattern = firstWord.slice(0, 8).replace(/[%_]/g, "");

  const { data: candidates } = await sb
    .from("organisers")
    .select("id, name, slug, bio, image_url")
    .is("claimed_by", null)
    .ilike("name", `%${ilikePattern}%`)
    .limit(30);

  const results = (candidates ?? []).filter((o: any) => {
    const on = normaliseName(o.name);
    if (on === norm) return true;
    if (norm.length >= 4 && on.length >= 4 && (on.includes(norm) || norm.includes(on))) return true;
    if (norm.length >= 3 && on.startsWith(norm)) return true;
    return false;
  });

  return results.map((o: any) => ({
    id: o.id,
    name: o.name,
    slug: o.slug,
    bio: o.bio,
    imageUrl: o.image_url,
  }));
}

export type ClaimOrganiserResult =
  | { ok: true; id: string; slug: string }
  | { error: string };

export async function claimOrganiser(organiserId: string): Promise<ClaimOrganiserResult> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };

  const sb = createServiceClient();

  const { data: organiser } = await sb
    .from("organisers")
    .select("id, slug, claimed_by")
    .eq("id", organiserId)
    .maybeSingle();
  if (!organiser) return { error: "Organiser not found." };
  if (organiser.claimed_by && organiser.claimed_by !== user.id) {
    return { error: "That page already has an owner. Pick another or create new." };
  }

  // Match venue-claim behaviour: leave approved status alone. An already-
  // public organiser page shouldn't go invisible just because someone
  // claims it — admin still gets the notification email and can
  // un-approve later if needed.
  const { error } = await sb
    .from("organisers")
    .update({ claimed_by: user.id })
    .eq("id", organiserId);
  if (error) return { error: error.message };

  // Block fans (role='user'). Other classified accounts (venue_owner who
  // also organises events, artist who books their own shows) get promoted
  // to event_organiser. Admin role preserved.
  const { data: profile } = await sb
    .from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (profile?.role === "user") {
    return {
      error:
        "You're signed up as a fan. To add an organiser page, contact admin or create a new account choosing 'Event organiser' at signup.",
    };
  }
  if (profile?.role === "venue_owner") {
    await sb.from("profiles").update({ role: "event_organiser" }).eq("id", user.id);
  }

  const { data: organiserRow } = await sb
    .from("organisers").select("name").eq("id", organiserId).maybeSingle();
  notifyNewOrganiser({
    organiserId,
    organiserName: organiserRow?.name ?? "Unknown organiser",
    claimerEmail: user.email ?? null,
  }).catch(() => {});

  revalidatePath("/dashboard");
  revalidatePath(`/organisers/${organiser.slug}`);
  return { ok: true, id: organiser.id, slug: organiser.slug };
}

export type CreateNewOrganiserResult =
  | { ok: true; id: string; slug: string }
  | { conflicts: UnclaimedOrganiserOption[] }
  | { error: string };

export async function createNewOrganiserForMe(opts: {
  name: string;
  forceCreate?: boolean;
}): Promise<CreateNewOrganiserResult> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };

  const name = opts.name.trim();
  if (name.length < 2) return { error: "Name must be at least 2 characters." };
  if (name.length > 200) return { error: "Name is too long (max 200)." };

  const sb = createServiceClient();
  const norm = normaliseName(name);

  // Already have an organiser with the same name? Idempotent return.
  const { data: existingMine } = await sb
    .from("organisers")
    .select("id, slug, name")
    .eq("claimed_by", user.id);
  const sameNameAlreadyMine = (existingMine ?? []).find(
    (o: any) => normaliseName(o.name) === norm,
  );
  if (sameNameAlreadyMine) {
    return { ok: true, id: sameNameAlreadyMine.id, slug: sameNameAlreadyMine.slug };
  }

  // Dupe check: any unclaimed with similar name?
  if (!opts.forceCreate) {
    const matches = await searchUnclaimedOrganisers(name);
    if (matches.length > 0) return { conflicts: matches };
  }

  // Block fans (role='user'); promote classified venue owners to organiser
  // since they're a real business account picking up a second hat.
  const { data: profile } = await sb
    .from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (profile?.role === "user") {
    return {
      error:
        "You're signed up as a fan. To add an organiser page, contact admin or create a new account choosing 'Event organiser' at signup.",
    };
  }
  if (profile?.role === "venue_owner") {
    await sb.from("profiles").update({ role: "event_organiser" }).eq("id", user.id);
  }

  const baseSlug = slugifyName(name) || "organiser";
  let slug = baseSlug;
  let created: any = null;
  for (let i = 0; i < 8; i++) {
    const { data, error } = await sb
      .from("organisers")
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
    return { error: (error as any)?.message ?? "Couldn't create organiser." };
  }
  if (!created) return { error: "Couldn't generate a unique URL slug." };

  notifyNewOrganiser({
    organiserId: created.id,
    organiserName: name,
    claimerEmail: user.email ?? null,
  }).catch(() => {});

  revalidatePath("/dashboard");
  revalidatePath("/organisers");
  return { ok: true, id: created.id, slug: created.slug };
}

export type MyOrganisersStatus =
  | null
  | {
      claimed: Array<{
        id: string;
        slug: string;
        name: string;
        approved: boolean;
        imageUrl: string | null;
      }>;
      suggestedName: string;
    };

export async function getMyOrganiserStatus(): Promise<MyOrganisersStatus> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const sb = createServiceClient();
  const [{ data: organisers }, { data: profile }] = await Promise.all([
    sb
      .from("organisers")
      .select("id, slug, name, approved, image_url")
      .eq("claimed_by", user.id)
      .order("name"),
    sb.from("profiles").select("display_name").eq("id", user.id).maybeSingle(),
  ]);

  return {
    claimed: (organisers ?? []).map((o: any) => ({
      id: o.id,
      slug: o.slug,
      name: o.name,
      approved: !!o.approved,
      imageUrl: o.image_url ?? null,
    })),
    suggestedName: profile?.display_name ?? "",
  };
}

// ============================================================
// Edit page actions — update profile fields
// ============================================================

export type UpdateOrganiserResult = { ok: true } | { error: string };

export async function updateOrganiser(
  organiserId: string,
  fields: {
    name?: string;
    bio?: string | null;
    image_url?: string | null;
    website?: string | null;
    instagram?: string | null;
    facebook?: string | null;
    twitter?: string | null;
    tiktok?: string | null;
    spotify?: string | null;
    bandcamp?: string | null;
    youtube?: string | null;
    email?: string | null;
  },
): Promise<UpdateOrganiserResult> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };

  const sb = createServiceClient();
  const { data: organiser } = await sb
    .from("organisers")
    .select("id, claimed_by, slug")
    .eq("id", organiserId)
    .maybeSingle();
  if (!organiser) return { error: "Organiser not found." };

  // Permission: claimer or admin
  const { data: profile } = await sb
    .from("profiles").select("role").eq("id", user.id).maybeSingle();
  const isAdmin = profile?.role === "admin";
  if (!isAdmin && organiser.claimed_by !== user.id) {
    return { error: "Not authorised to edit this organiser." };
  }

  // Filter to only the keys the caller actually provided (so blank fields
  // they didn't touch don't get nulled out).
  const update: Record<string, any> = {};
  for (const [k, v] of Object.entries(fields)) {
    if (v !== undefined) update[k] = v === "" ? null : v;
  }
  if (Object.keys(update).length === 0) return { ok: true };

  const { error } = await sb
    .from("organisers")
    .update(update)
    .eq("id", organiserId);
  if (error) return { error: error.message };

  revalidatePath(`/organisers/${organiser.slug}`);
  revalidatePath(`/dashboard/organiser/${organiserId}/edit`);
  return { ok: true };
}
