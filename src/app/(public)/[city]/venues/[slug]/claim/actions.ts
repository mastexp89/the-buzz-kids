"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { notifyVenueClaim } from "@/lib/email";

export type SubmitClaimResult =
  | { ok: true; venueName: string }
  | { error: string };

// Shared validated fields pulled from the claim form (both flows).
type ClaimFields = {
  firstName: string | null;
  lastName: string | null;
  businessName: string | null;
  businessType: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
  reason: string | null;
  authorisedRep: boolean;
  acceptedTerms: boolean;
};

function readClaimFields(formData: FormData): ClaimFields {
  const businessTypeRaw = String(formData.get("business_type") ?? "").trim();
  const businessType = ["individual", "multiple", "agency"].includes(businessTypeRaw)
    ? businessTypeRaw
    : null;
  return {
    firstName: String(formData.get("first_name") ?? "").trim() || null,
    lastName: String(formData.get("last_name") ?? "").trim() || null,
    businessName: String(formData.get("business_name") ?? "").trim() || null,
    businessType,
    contactPhone: String(formData.get("contact_phone") ?? "").trim() || null,
    contactEmail: String(formData.get("contact_email") ?? "").trim() || null,
    reason: String(formData.get("reason") ?? "").trim() || null,
    authorisedRep: formData.get("authorised_rep") === "on" || formData.get("authorised_rep") === "true",
    acceptedTerms: formData.get("accepted_terms") === "on" || formData.get("accepted_terms") === "true",
  };
}

/**
 * Logged-in path: an existing account claims an unclaimed venue. Inserts the
 * claim under the user's own RLS context and refreshes their profile name if
 * they gave one.
 */
export async function submitVenueClaim(formData: FormData): Promise<SubmitClaimResult> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "You need to be signed in to claim a place." };

  const venueId = String(formData.get("venue_id") ?? "").trim();
  if (!venueId) return { error: "Missing place id." };

  const f = readClaimFields(formData);
  if (!f.authorisedRep) return { error: "Please confirm you're an authorised representative." };
  if (!f.acceptedTerms) return { error: "Please accept the Terms of Service to continue." };
  if (!f.businessName) return { error: "Please enter your business name." };

  const { data: venue } = await supabase
    .from("venues")
    .select("id, name, slug, owner_id, city:cities(name, slug)")
    .eq("id", venueId)
    .single();
  if (!venue) return { error: "Place not found." };
  if (venue.owner_id) {
    return { error: "This place already has an owner. Get in touch if you believe this is a mistake." };
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("display_name, email")
    .eq("id", user.id)
    .maybeSingle();

  const { error: insertErr } = await supabase
    .from("venue_claims")
    .insert({
      venue_id: venue.id,
      claimant_user_id: user.id,
      role: f.businessType,
      business_name: f.businessName,
      business_type: f.businessType,
      contact_phone: f.contactPhone,
      contact_email: f.contactEmail ?? user.email ?? null,
      reason: f.reason,
      authorised_rep: f.authorisedRep,
      accepted_terms: f.acceptedTerms,
      status: "pending",
    });
  if (insertErr) {
    if (insertErr.code === "23505") {
      return { error: "You already have a pending claim on this place." };
    }
    return { error: insertErr.message };
  }

  // Fill the profile name from the form if it was blank.
  const fullName = [f.firstName, f.lastName].filter(Boolean).join(" ").trim();
  if (fullName && !profile?.display_name) {
    await supabase.from("profiles").update({ display_name: fullName }).eq("id", user.id);
  }

  notifyVenueClaim({
    venueName: venue.name,
    venueId: venue.id,
    citySlug: (venue.city as any)?.slug ?? null,
    venueSlug: venue.slug,
    claimantEmail: user.email ?? null,
    claimantName: fullName || profile?.display_name || null,
    role: f.businessType,
    businessName: f.businessName,
    businessType: f.businessType,
    contactPhone: f.contactPhone,
    reason: f.reason,
  }).catch(() => {});

  revalidatePath(`/admin/queue`);
  revalidatePath(`/${(venue.city as any)?.slug ?? "dundee"}/venues/${venue.slug}`);
  return { ok: true, venueName: venue.name };
}

/**
 * Logged-out path: the form already created the auth user client-side via
 * supabase.auth.signUp (so the confirmation email gets sent through the
 * normal flow). The user may not have a session yet — email confirmation
 * is pending — so we can't insert the claim under their RLS context. This
 * action runs with the service client, verifies the passed userId really
 * owns the submitted email (via the admin API, so it can't be spoofed),
 * then attaches the claim.
 */
export async function attachClaimAfterSignup(input: {
  userId: string;
  email: string;
  venueId: string;
  formData: { [k: string]: string };
}): Promise<SubmitClaimResult> {
  const { userId, email, venueId } = input;
  if (!userId || !venueId) return { error: "Missing details — please try again." };

  const fd = new FormData();
  for (const [k, v] of Object.entries(input.formData ?? {})) fd.set(k, v);
  const f = readClaimFields(fd);
  if (!f.authorisedRep) return { error: "Please confirm you're an authorised representative." };
  if (!f.acceptedTerms) return { error: "Please accept the Terms of Service to continue." };

  const svc = createServiceClient();

  // Verify the userId genuinely owns this email — defends against a client
  // passing someone else's id. getUserById is admin-only (service role).
  const { data: userRes, error: userErr } = await svc.auth.admin.getUserById(userId);
  if (userErr || !userRes?.user) return { error: "Account not found — please try again." };
  if ((userRes.user.email ?? "").toLowerCase() !== email.toLowerCase()) {
    return { error: "Account verification failed — please try again." };
  }

  const { data: venue } = await svc
    .from("venues")
    .select("id, name, slug, owner_id, city:cities(name, slug)")
    .eq("id", venueId)
    .single();
  if (!venue) return { error: "Place not found." };
  if (venue.owner_id) {
    return { error: "This place was just claimed by someone else. Get in touch if that's a mistake." };
  }

  const { error: insertErr } = await svc
    .from("venue_claims")
    .insert({
      venue_id: venue.id,
      claimant_user_id: userId,
      role: f.businessType,
      business_name: f.businessName,
      business_type: f.businessType,
      contact_phone: f.contactPhone,
      contact_email: email,
      reason: f.reason,
      authorised_rep: f.authorisedRep,
      accepted_terms: f.acceptedTerms,
      status: "pending",
    });
  if (insertErr && insertErr.code !== "23505") {
    return { error: insertErr.message };
  }

  // Make sure the profile carries their name + that they're a venue account.
  const fullName = [f.firstName, f.lastName].filter(Boolean).join(" ").trim();
  await svc
    .from("profiles")
    .update({
      ...(fullName ? { display_name: fullName } : {}),
      role: "venue",
    })
    .eq("id", userId);

  notifyVenueClaim({
    venueName: venue.name,
    venueId: venue.id,
    citySlug: (venue.city as any)?.slug ?? null,
    venueSlug: venue.slug,
    claimantEmail: email,
    claimantName: fullName || null,
    role: f.businessType,
    businessName: f.businessName,
    businessType: f.businessType,
    contactPhone: f.contactPhone,
    reason: f.reason,
  }).catch(() => {});

  revalidatePath(`/admin/queue`);
  return { ok: true, venueName: venue.name };
}
