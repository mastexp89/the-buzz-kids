"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import {
  notifyClaimApproved,
  notifyClaimRejected,
  notifyArtistClaimApproved,
  notifyArtistClaimRejected,
} from "@/lib/email";
import { sendApprovalWelcomeMessage } from "@/lib/welcome-message";
import { slugify } from "@/lib/utils";
import { geocodePostcode } from "@/lib/geocode";

async function requireAdmin() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: prof } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (prof?.role !== "admin") return null;
  return { supabase, user };
}

// ---------- Events ----------

export async function approveEvent(eventId: string) {
  const ctx = await requireAdmin();
  if (!ctx) return { error: "Not authorised." };
  const { supabase, user } = ctx;
  const { error } = await supabase
    .from("events")
    .update({
      status: "approved",
      reviewed_at: new Date().toISOString(),
      reviewed_by: user.id,
    })
    .eq("id", eventId);
  if (error) return { error: error.message };
  revalidatePath("/admin/queue");
  return { ok: true };
}

// Promote the venue a queued event is attached to into a live Place on the
// directory. Used when a "session" is really just a place (general admission /
// opening hours) — you make the venue a Place, then reject the redundant event
// knowing the place itself is now on the site.
export async function makeVenueAPlace(venueId: string) {
  const ctx = await requireAdmin();
  if (!ctx) return { error: "Not authorised." };
  const { supabase } = ctx;
  const { data: v } = await supabase
    .from("venues")
    .select("venue_type, approved, name, slug, city:cities(slug)")
    .eq("id", venueId)
    .maybeSingle();
  if (!v) return { error: "Venue not found." };
  // Keep an existing attraction/both type; otherwise make it visitable. A
  // programmes-only (event-host) venue becomes "both" so it stays an event
  // host AND shows on the Places page.
  const current = (v as any).venue_type;
  const newType = current === "attraction" || current === "both" ? current : "both";
  const { error } = await supabase
    .from("venues")
    .update({ approved: true, venue_type: newType })
    .eq("id", venueId);
  if (error) return { error: error.message };
  revalidatePath("/admin/queue");
  const citySlug = (v as any).city?.slug ?? "dundee";
  return { ok: true, href: `/${citySlug}/venues/${(v as any).slug}`, name: (v as any).name };
}

// Live search of live Places, for reassigning an event that got attached to
// the wrong venue (the tourism-feed dumps). Admin-only.
export async function searchPlaces(query: string) {
  const ctx = await requireAdmin();
  if (!ctx) return { results: [] as any[] };
  const q = query.trim();
  if (q.length < 2) return { results: [] as any[] };
  const { supabase } = ctx;
  const { data } = await supabase
    .from("venues")
    .select("id, name, slug, venue_type, city:cities(name, slug)")
    .ilike("name", `%${q}%`)
    .eq("approved", true)
    .in("venue_type", ["attraction", "both", "programmes"])
    .order("name")
    .limit(8);
  return { results: data ?? [] };
}

// Move an event onto a different venue (and that venue's city).
export async function reassignEventVenue(eventId: string, venueId: string) {
  const ctx = await requireAdmin();
  if (!ctx) return { error: "Not authorised." };
  const { supabase } = ctx;
  const { data: v } = await supabase
    .from("venues")
    .select("id, name, slug, city_id, approved, venue_type, city:cities(name, slug)")
    .eq("id", venueId)
    .maybeSingle();
  if (!v) return { error: "Venue not found." };
  const { error } = await supabase
    .from("events")
    .update({ venue_id: venueId, city_id: (v as any).city_id })
    .eq("id", eventId);
  if (error) return { error: error.message };
  revalidatePath("/admin/queue");
  return { ok: true, venue: v };
}

// Create a brand-new Place from typed/Google-searched details and attach a
// queued event to it — for wrong-venue events whose correct place isn't on the
// site yet. Creates the venue live (approved) and approves the event.
export async function createPlaceAndAttach(
  eventId: string,
  place: {
    name: string; address?: string; postcode?: string; phone?: string; website?: string;
    googlePlaceId?: string; latitude?: number | null; longitude?: number | null; cityId: string;
  },
) {
  const ctx = await requireAdmin();
  if (!ctx) return { error: "Not authorised." };
  const { supabase } = ctx;
  if (!place?.name?.trim() || !place?.cityId) return { error: "Name and area are required." };

  // Unique slug.
  const base = (slugify(place.name).slice(0, 90) || "place");
  let slug = base;
  for (let n = 2; n < 30; n++) {
    const { data: exists } = await supabase.from("venues").select("id").eq("slug", slug).maybeSingle();
    if (!exists) break;
    slug = `${base}-${n}`;
  }

  let latitude = place.latitude ?? null;
  let longitude = place.longitude ?? null;
  if ((latitude == null || longitude == null) && place.postcode) {
    const geo = await geocodePostcode(place.postcode);
    if (geo) { latitude = geo.lat; longitude = geo.lng; }
  }

  const { data: venue, error: vErr } = await supabase
    .from("venues")
    .insert({
      name: place.name.trim(),
      slug,
      address: place.address || null,
      postcode: place.postcode || null,
      phone: place.phone || null,
      website: place.website || null,
      google_place_id: place.googlePlaceId || null,
      city_id: place.cityId,
      latitude,
      longitude,
      venue_type: "both", // a real place that also hosts events
      approved: true,
    })
    .select("id, slug, city:cities(slug)")
    .single();
  if (vErr || !venue) return { error: vErr?.message ?? "Couldn't create the place." };

  // Attach + approve the event; strip any stale ⚠ wrong-venue note.
  const { data: ev } = await supabase.from("events").select("description").eq("id", eventId).maybeSingle();
  let desc = ev?.description ?? "";
  if (desc.startsWith("⚠")) desc = desc.replace(/^⚠[\s\S]*?\n\n/, "");
  const { error: eErr } = await supabase
    .from("events")
    .update({ venue_id: venue.id, city_id: place.cityId, description: desc, status: "approved", reviewed_at: new Date().toISOString() })
    .eq("id", eventId);
  if (eErr) return { error: eErr.message };

  revalidatePath("/admin/queue");
  return { ok: true, venue: { id: venue.id, slug: venue.slug, citySlug: (venue as any).city?.slug ?? "dundee" } };
}

export async function rejectEvent(eventId: string) {
  const ctx = await requireAdmin();
  if (!ctx) return { error: "Not authorised." };
  const { supabase, user } = ctx;
  const { error } = await supabase
    .from("events")
    .update({
      status: "rejected",
      reviewed_at: new Date().toISOString(),
      reviewed_by: user.id,
    })
    .eq("id", eventId);
  if (error) return { error: error.message };
  revalidatePath("/admin/queue");
  return { ok: true };
}

// ---------- Artists ----------

export async function approveArtist(artistId: string) {
  const ctx = await requireAdmin();
  if (!ctx) return { error: "Not authorised." };
  const { supabase } = ctx;
  const { error } = await supabase.from("artists").update({ approved: true }).eq("id", artistId);
  if (error) return { error: error.message };

  // Welcome message into the claimer's in-app thread.
  const { data: artist } = await supabase
    .from("artists")
    .select("name, claimed_by")
    .eq("id", artistId)
    .maybeSingle();
  if (artist?.claimed_by && artist.name) {
    await sendApprovalWelcomeMessage({
      userId: artist.claimed_by,
      kind: "artist",
      displayName: artist.name,
    });
  }

  revalidatePath("/admin/queue");
  return { ok: true };
}

export async function deleteArtist(artistId: string) {
  const ctx = await requireAdmin();
  if (!ctx) return { error: "Not authorised." };
  const { supabase } = ctx;
  const { error } = await supabase.from("artists").delete().eq("id", artistId);
  if (error) return { error: error.message };
  revalidatePath("/admin/queue");
  return { ok: true };
}

// ---------- Venue suggestions ----------

export async function dismissSuggestion(suggestionId: string) {
  const ctx = await requireAdmin();
  if (!ctx) return { error: "Not authorised." };
  const { supabase, user } = ctx;
  const { error } = await supabase
    .from("venue_suggestions")
    .update({
      status: "rejected",
      reviewed_at: new Date().toISOString(),
      reviewed_by: user.id,
    })
    .eq("id", suggestionId);
  if (error) return { error: error.message };
  revalidatePath("/admin/queue");
  return { ok: true };
}

export async function deleteSuggestion(suggestionId: string) {
  const ctx = await requireAdmin();
  if (!ctx) return { error: "Not authorised." };
  const { supabase } = ctx;
  const { error } = await supabase.from("venue_suggestions").delete().eq("id", suggestionId);
  if (error) return { error: error.message };
  revalidatePath("/admin/queue");
  return { ok: true };
}

// ---------- Venue claims (Take Ownership) ----------

export async function approveVenueClaim(
  claimId: string,
  // Optional override. When true, the venue's existing owner is replaced
  // by the claimant — used when the previous owner row was a setup-wizard
  // stub, an abandoned account, or a wrong assignment. Without this the
  // approve action refuses to overwrite an existing owner_id (sensible
  // default — don't accidentally yank a venue away from its real owner
  // because admin clicked the wrong button).
  opts: { transferFromExistingOwner?: boolean } = {},
) {
  const ctx = await requireAdmin();
  if (!ctx) return { error: "Not authorised." };
  const { user } = ctx;

  // Use service client so we can update venues.owner_id even if RLS would block.
  const sb = createServiceClient();

  // Fetch the claim + venue for the email
  const { data: claim } = await sb
    .from("venue_claims")
    .select(`
      id, status, venue_id, claimant_user_id, contact_email,
      venue:venues(id, name, slug, owner_id, city:cities(slug))
    `)
    .eq("id", claimId)
    .maybeSingle();
  if (!claim) return { error: "Claim not found." };
  if (claim.status !== "pending") return { error: "Claim is not pending." };

  const existingOwnerId: string | null = (claim.venue as any)?.owner_id ?? null;

  // Case A: claimant ALREADY owns this venue (e.g. they took it via the
  // dashboard setup wizard, then later also submitted a formal claim
  // through the public claim form). The claim is redundant — they
  // already own the venue. Just mark the claim approved so it clears
  // from the queue. The owner_id stays as-is; no confusing transfer
  // email, no "Reject this claim or transfer manually" loop.
  if (existingOwnerId && existingOwnerId === claim.claimant_user_id) {
    const { error: cErrSelf } = await sb
      .from("venue_claims")
      .update({
        status: "approved",
        reviewed_at: new Date().toISOString(),
        reviewed_by: user.id,
      })
      .eq("id", claimId);
    if (cErrSelf) return { error: cErrSelf.message };
    // Auto-reject any other pending claims from other users on the same
    // venue (only one owner — and that's already this user).
    await sb
      .from("venue_claims")
      .update({
        status: "rejected",
        reviewed_at: new Date().toISOString(),
        reviewed_by: user.id,
        rejection_reason: "Another claim was approved first",
      })
      .eq("venue_id", claim.venue_id)
      .eq("status", "pending");
    revalidatePath("/admin/queue");
    revalidatePath("/admin");
    return { ok: true, redundant: true as const };
  }

  // Case B: a DIFFERENT user is already the owner. Default refuses to
  // overwrite (safety); admin must pass transferFromExistingOwner via
  // the "Transfer ownership" button to confirm the swap.
  if (existingOwnerId && !opts.transferFromExistingOwner) {
    return {
      error: "Venue already has an owner.",
      hasExistingOwner: true as const,
    };
  }

  const venue = claim.venue as any;
  const citySlug = venue?.city?.slug ?? "dundee";

  // 1. Set the venue owner. When transferring, this overwrites the prior
  // owner_id atomically. The prior owner loses dashboard access but their
  // user account stays intact — they can re-claim if it was a mistake.
  const { error: vErr } = await sb
    .from("venues")
    .update({ owner_id: claim.claimant_user_id })
    .eq("id", claim.venue_id);
  if (vErr) return { error: vErr.message };

  // 2. Mark this claim approved
  const { error: cErr } = await sb
    .from("venue_claims")
    .update({
      status: "approved",
      reviewed_at: new Date().toISOString(),
      reviewed_by: user.id,
    })
    .eq("id", claimId);
  if (cErr) return { error: cErr.message };

  // 3. Auto-reject any other pending claims on the same venue (only one owner)
  await sb
    .from("venue_claims")
    .update({
      status: "rejected",
      reviewed_at: new Date().toISOString(),
      reviewed_by: user.id,
      rejection_reason: "Another claim was approved first",
    })
    .eq("venue_id", claim.venue_id)
    .eq("status", "pending");

  // 4. Email the claimant
  // Look up their email from the profile (more reliable than auth.users)
  const { data: claimantProfile } = await sb
    .from("profiles")
    .select("email")
    .eq("id", claim.claimant_user_id)
    .maybeSingle();
  const email = claimantProfile?.email ?? claim.contact_email;
  if (email && venue?.slug) {
    notifyClaimApproved({
      claimantEmail: email,
      venueName: venue.name,
      citySlug,
      venueSlug: venue.slug,
      venueId: venue.id,
    }).catch(() => {});
  }

  // In-app welcome message — open support channel they can reply to.
  if (claim.claimant_user_id && venue?.name) {
    await sendApprovalWelcomeMessage({
      userId: claim.claimant_user_id,
      kind: "venue",
      displayName: venue.name,
    });
  }

  revalidatePath("/admin/queue");
  revalidatePath("/admin");
  revalidatePath(`/${citySlug}/venues/${venue.slug}`);
  return { ok: true };
}

export async function rejectVenueClaim(claimId: string, reason?: string) {
  const ctx = await requireAdmin();
  if (!ctx) return { error: "Not authorised." };
  const { user } = ctx;
  const sb = createServiceClient();

  const { data: claim } = await sb
    .from("venue_claims")
    .select(`id, status, claimant_user_id, contact_email, venue:venues(name)`)
    .eq("id", claimId)
    .maybeSingle();
  if (!claim) return { error: "Claim not found." };
  if (claim.status !== "pending") return { error: "Claim is not pending." };

  const { error } = await sb
    .from("venue_claims")
    .update({
      status: "rejected",
      reviewed_at: new Date().toISOString(),
      reviewed_by: user.id,
      rejection_reason: reason || null,
    })
    .eq("id", claimId);
  if (error) return { error: error.message };

  // Email the claimant
  const { data: claimantProfile } = await sb
    .from("profiles")
    .select("email")
    .eq("id", claim.claimant_user_id)
    .maybeSingle();
  const email = claimantProfile?.email ?? claim.contact_email;
  if (email) {
    notifyClaimRejected({
      claimantEmail: email,
      venueName: (claim.venue as any)?.name ?? "your venue",
      reason: reason ?? null,
    }).catch(() => {});
  }

  revalidatePath("/admin/queue");
  return { ok: true };
}

// ---------- Artist claims (Take Ownership for artist pages) ----------

export async function approveArtistClaim(claimId: string) {
  const ctx = await requireAdmin();
  if (!ctx) return { error: "Not authorised." };
  const { user } = ctx;
  const sb = createServiceClient();

  const { data: claim } = await sb
    .from("artist_claims")
    .select(`
      id, status, artist_id, claimant_user_id, contact_email,
      artist:artists(id, name, slug, claimed_by)
    `)
    .eq("id", claimId)
    .maybeSingle();
  if (!claim) return { error: "Claim not found." };
  if (claim.status !== "pending") return { error: "Claim is not pending." };
  if ((claim.artist as any)?.claimed_by) {
    return { error: "Artist page already has an owner." };
  }

  const artist = claim.artist as any;

  const { error: aErr } = await sb
    .from("artists")
    .update({ claimed_by: claim.claimant_user_id })
    .eq("id", claim.artist_id);
  if (aErr) return { error: aErr.message };

  const { error: cErr } = await sb
    .from("artist_claims")
    .update({
      status: "approved",
      reviewed_at: new Date().toISOString(),
      reviewed_by: user.id,
    })
    .eq("id", claimId);
  if (cErr) return { error: cErr.message };

  await sb
    .from("artist_claims")
    .update({
      status: "rejected",
      reviewed_at: new Date().toISOString(),
      reviewed_by: user.id,
      rejection_reason: "Another claim was approved first",
    })
    .eq("artist_id", claim.artist_id)
    .eq("status", "pending");

  const { data: claimantProfile } = await sb
    .from("profiles")
    .select("email")
    .eq("id", claim.claimant_user_id)
    .maybeSingle();
  const email = claimantProfile?.email ?? claim.contact_email;
  if (email && artist?.slug) {
    notifyArtistClaimApproved({
      claimantEmail: email,
      artistName: artist.name,
      artistSlug: artist.slug,
      artistId: artist.id,
    }).catch(() => {});
  }

  if (claim.claimant_user_id && artist?.name) {
    await sendApprovalWelcomeMessage({
      userId: claim.claimant_user_id,
      kind: "artist",
      displayName: artist.name,
    });
  }

  revalidatePath("/admin/queue");
  revalidatePath(`/artists/${artist.slug}`);
  return { ok: true };
}

export async function rejectArtistClaim(claimId: string, reason?: string) {
  const ctx = await requireAdmin();
  if (!ctx) return { error: "Not authorised." };
  const { user } = ctx;
  const sb = createServiceClient();

  const { data: claim } = await sb
    .from("artist_claims")
    .select(`id, status, claimant_user_id, contact_email, artist:artists(name)`)
    .eq("id", claimId)
    .maybeSingle();
  if (!claim) return { error: "Claim not found." };
  if (claim.status !== "pending") return { error: "Claim is not pending." };

  const { error } = await sb
    .from("artist_claims")
    .update({
      status: "rejected",
      reviewed_at: new Date().toISOString(),
      reviewed_by: user.id,
      rejection_reason: reason || null,
    })
    .eq("id", claimId);
  if (error) return { error: error.message };

  const { data: claimantProfile } = await sb
    .from("profiles")
    .select("email")
    .eq("id", claim.claimant_user_id)
    .maybeSingle();
  const email = claimantProfile?.email ?? claim.contact_email;
  if (email) {
    notifyArtistClaimRejected({
      claimantEmail: email,
      artistName: (claim.artist as any)?.name ?? "your artist",
      reason: reason ?? null,
    }).catch(() => {});
  }

  revalidatePath("/admin/queue");
  return { ok: true };
}
