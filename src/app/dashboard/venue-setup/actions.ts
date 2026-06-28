"use server";

// Post-signup setup wizard for venue owners.
// Mirrors /dashboard/setup (artists) — search the directory for an
// unowned matching venue first, claim it if found, otherwise create new.
//
// Both paths land the venue with approved=false, so admin reviews the
// first claim/create before the page goes public. Subsequent edits by
// the owner go live immediately (until/unless admin un-approves).

import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { notifyNewVenue } from "@/lib/email";
import { revalidatePath } from "next/cache";

function normaliseVenueName(s: string): string {
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

export type UnclaimedVenueOption = {
  id: string;
  name: string;
  slug: string;
  citySlug: string | null;
  cityName: string | null;
  // Town extracted from address (e.g. "Forfar") so people can pick the right
  // "Central Bar" when several towns have one.
  town: string | null;
  address: string | null;
  approved: boolean;
  imageUrl: string | null;
};

function extractTown(address: string | null): string | null {
  if (!address) return null;
  const postcodeRegex = /[A-Z]{1,2}\d{1,2}[A-Z]?\s*\d[A-Z]{2}/i;
  const parts = address.split(",").map((s) => s.trim()).filter(Boolean);
  for (let i = parts.length - 1; i >= 0; i--) {
    if (postcodeRegex.test(parts[i])) {
      const beforePostcode = parts[i].replace(postcodeRegex, "").trim();
      if (beforePostcode) return beforePostcode;
      if (i > 0) return parts[i - 1];
    }
  }
  return parts[parts.length - 1] ?? null;
}

export async function searchUnclaimedVenues(query: string): Promise<UnclaimedVenueOption[]> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];
  const q = query.trim();
  if (q.length < 2) return [];

  const sb = createServiceClient();
  const norm = normaliseVenueName(q);

  // Strip a leading "the " from the SQL search too — otherwise typing
  // "the balmore" runs `%the balmore%` and never finds "Balmore Bar".
  const qStripped = q.replace(/^the\s+/i, "").trim() || q;

  // SQL pre-filter pattern. We use the FIRST significant alphanumeric
  // word of the query (stripped of apostrophes, ampersands, etc.) so
  // a search for "Megan's Sports Bar & Club" still surfaces a DB record
  // stored as "Megans Sports Bar and Club" — the post-filter below then
  // does the fuzzy match on the fully normalised names. Without this,
  // a single apostrophe difference between query and stored name silently
  // killed every match and let users create duplicate venues.
  const alphanumeric = qStripped.replace(/[^a-zA-Z0-9\s]/g, " ").trim();
  const firstWord =
    alphanumeric.split(/\s+/).find((w) => w.length >= 3) ||
    alphanumeric.slice(0, 5) ||
    qStripped;
  const ilikePattern = firstWord.slice(0, 8).replace(/[%_]/g, "");

  const { data: candidates } = await sb
    .from("venues")
    .select(
      "id, name, slug, address, approved, image_url, logo_url, cover_photo_url, city:cities(name, slug)",
    )
    .is("owner_id", null)
    .ilike("name", `%${ilikePattern}%`)
    .limit(60);

  const results = (candidates ?? []).filter((v: any) => {
    const vn = normaliseVenueName(v.name);
    if (vn === norm) return true;
    if (norm.length >= 4 && vn.length >= 4 && (vn.includes(norm) || norm.includes(vn))) return true;
    if (norm.length >= 3 && vn.startsWith(norm)) return true;
    return false;
  });

  return results.map((v: any) => ({
    id: v.id,
    name: v.name,
    slug: v.slug,
    citySlug: v.city?.slug ?? null,
    cityName: v.city?.name ?? null,
    town: extractTown(v.address),
    address: v.address,
    approved: !!v.approved,
    imageUrl: v.logo_url ?? v.cover_photo_url ?? v.image_url ?? null,
  }));
}

export type ClaimVenueResult =
  | { ok: true; venueId: string; slug: string; citySlug: string }
  | { error: string };

/**
 * Claim an existing unowned venue. Sets owner_id to the current user.
 * If the venue was already approved (e.g. auto-imported public pub), we
 * leave it approved — admin can flip if the claim turns out bogus.
 * If not yet approved, leave it pending so admin reviews the new owner +
 * the venue page together.
 */
export async function claimVenue(venueId: string): Promise<ClaimVenueResult> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };

  const sb = createServiceClient();

  // Block fans (role='user'). A fan signing up shouldn't be able to bypass
  // intent by hitting the venue-setup URL directly. Real legacy unclassified
  // users (rare) should contact admin to be re-classified.
  const { data: callerProfile } = await sb
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();
  if (callerProfile?.role === "user") {
    return {
      error:
        "You're signed up as a fan. To list a venue, please contact admin or create a new account choosing 'Venue' at signup.",
    };
  }

  const { data: venue } = await sb
    .from("venues")
    .select("id, slug, owner_id, city:cities(slug)")
    .eq("id", venueId)
    .maybeSingle();
  if (!venue) return { error: "Venue not found." };
  if (venue.owner_id && venue.owner_id !== user.id) {
    return { error: "That venue page already has an owner. Pick another or create new." };
  }

  const { error } = await sb
    .from("venues")
    .update({ owner_id: user.id })
    .eq("id", venueId);
  if (error) return { error: error.message };

  // No need to promote role here — the guard at the top of claimVenue
  // bails out for role='user' (fans), so by the time we get here the
  // caller is already venue_owner/admin and the profile role is correct.

  // Also create a pending venue_claims row so admin has something to
  // review in /admin/queue. Without this, admin gets the "new venue
  // pending" email but the queue is empty — confusing. The venue itself
  // stays approved (= public page doesn't 404 mid-review) but the claim
  // record gives admin a trail to verify the claimant is legit.
  // Unique partial index venue_claims_one_pending_per_user_per_venue
  // makes a second claim by the same user on the same venue silently
  // no-op; we swallow the error either way.
  await sb
    .from("venue_claims")
    .insert({
      venue_id: venueId,
      claimant_user_id: user.id,
      status: "pending",
      contact_email: user.email ?? null,
      reason: "Claimed via dashboard venue setup wizard",
    });

  // Notify admin so they can verify the new owner is legit. Fetch the
  // venue name + city in one go since the earlier select didn't pull them.
  const { data: venueRow } = await sb
    .from("venues")
    .select("name, city:cities(name)")
    .eq("id", venueId)
    .maybeSingle();
  notifyNewVenue({
    venueId: venue.id,
    venueName: venueRow?.name ?? "Unknown venue",
    ownerEmail: user.email ?? null,
    cityName: (venueRow?.city as any)?.name ?? null,
  }).catch(() => {});

  revalidatePath("/dashboard");
  revalidatePath(`/${(venue.city as any)?.slug ?? "dundee"}/venues/${venue.slug}`);
  return {
    ok: true,
    venueId: venue.id,
    slug: venue.slug,
    citySlug: (venue.city as any)?.slug ?? "dundee",
  };
}

export type CreateNewVenueResult =
  | { ok: true; venueId: string; slug: string; citySlug: string }
  | { conflicts: UnclaimedVenueOption[] }
  | { error: string };

/**
 * Create a brand-new venue with the user as owner and approved=false
 * (admin reviews before it goes public). If a similar unclaimed venue
 * already exists in the DB, return it as a conflict so the user can
 * confirm they really want a new one (prevents duplicates).
 */
export async function createNewVenueForMe(opts: {
  name: string;
  citySlug?: string;
  forceCreate?: boolean;
}): Promise<CreateNewVenueResult> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };

  const name = opts.name.trim();
  if (name.length < 2) return { error: "Venue name must be at least 2 characters." };
  if (name.length > 120) return { error: "Venue name is too long (max 120)." };

  const sb = createServiceClient();

  // Block fans — same guard as claimVenue. Stops a fan submitting a
  // direct POST to bypass the page-level check.
  const { data: callerProfile } = await sb
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();
  if (callerProfile?.role === "user") {
    return {
      error:
        "You're signed up as a fan. To list a venue, please contact admin or create a new account choosing 'Venue' at signup.",
    };
  }

  // Dupe check: any unclaimed venue with similar normalised name?
  if (!opts.forceCreate) {
    const matches = await searchUnclaimedVenues(name);
    if (matches.length > 0) return { conflicts: matches };
  }

  // Resolve city. Default to first active city if not specified.
  let cityId: string | null = null;
  let citySlug = opts.citySlug ?? "";
  const { data: cities } = await sb
    .from("cities")
    .select("id, slug, active")
    .eq("active", true)
    .order("name");
  if (citySlug) {
    const found = (cities ?? []).find((c: any) => c.slug === citySlug);
    if (found) cityId = found.id;
  }
  if (!cityId && cities && cities.length > 0) {
    // Default: Dundee if present, else first active city
    const dundee = cities.find((c: any) => c.slug === "dundee");
    const pick = dundee ?? cities[0];
    cityId = pick.id;
    citySlug = pick.slug;
  }
  if (!cityId) return { error: "No active cities configured. Contact admin." };

  // No role promotion — guard at the top blocks fans before they reach
  // this point. Existing venue_owner / admin users keep their role.

  // Generate unique slug
  const baseSlug = slugifyName(name) || "venue";
  let slug = baseSlug;
  let created: any = null;
  for (let i = 0; i < 8; i++) {
    const { data, error } = await sb
      .from("venues")
      .insert({
        name,
        slug,
        owner_id: user.id,
        city_id: cityId,
        approved: false,
      })
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
    return { error: (error as any)?.message ?? "Couldn't create venue." };
  }
  if (!created) return { error: "Couldn't generate a unique URL slug." };

  // Notify admin so the new venue surfaces in the approval queue.
  const { data: cityRow } = await sb
    .from("cities").select("name").eq("id", cityId).maybeSingle();
  notifyNewVenue({
    venueId: created.id,
    venueName: name,
    ownerEmail: user.email ?? null,
    cityName: cityRow?.name ?? null,
  }).catch(() => {});

  revalidatePath("/dashboard");
  return { ok: true, venueId: created.id, slug: created.slug, citySlug };
}

export type MyVenuesStatus =
  | null
  | {
      claimed: Array<{
        id: string;
        slug: string;
        name: string;
        approved: boolean;
        cityName: string | null;
        imageUrl: string | null;
      }>;
      // Best guess at what they might want to call their venue (set at
      // signup via raw_user_meta_data.venue_name, otherwise display_name)
      suggestedName: string;
      // Active cities so the create form has a city dropdown
      cities: Array<{ slug: string; name: string }>;
    };

/**
 * Status of the signed-in user's venue ownership. Drives the wizard's
 * "Your venues so far" banner and seeds the search box.
 */
export async function getMyVenueStatus(): Promise<MyVenuesStatus> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const sb = createServiceClient();

  const [{ data: venues }, { data: profile }, { data: cities }] = await Promise.all([
    sb
      .from("venues")
      .select("id, slug, name, approved, image_url, logo_url, city:cities(name)")
      .eq("owner_id", user.id)
      .order("name"),
    sb.from("profiles").select("display_name").eq("id", user.id).maybeSingle(),
    sb
      .from("cities")
      .select("slug, name")
      .eq("active", true)
      .order("name"),
  ]);

  // Try the venue_name from signup metadata first (most accurate intent),
  // then fall back to display_name.
  const venueNameFromSignup =
    typeof (user.user_metadata as any)?.venue_name === "string"
      ? String((user.user_metadata as any).venue_name).trim()
      : "";

  return {
    claimed: (venues ?? []).map((v: any) => ({
      id: v.id,
      slug: v.slug,
      name: v.name,
      approved: !!v.approved,
      cityName: v.city?.name ?? null,
      imageUrl: v.logo_url ?? v.image_url ?? null,
    })),
    suggestedName: venueNameFromSignup || profile?.display_name || "",
    cities: (cities ?? []).map((c: any) => ({ slug: c.slug, name: c.name })),
  };
}
