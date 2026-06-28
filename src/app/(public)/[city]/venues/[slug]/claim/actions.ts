"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { notifyVenueClaim } from "@/lib/email";

export type SubmitClaimResult =
  | { ok: true; venueName: string }
  | { error: string };

export async function submitVenueClaim(formData: FormData): Promise<SubmitClaimResult> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "You need to be signed in to claim a venue." };

  const venueId = String(formData.get("venue_id") ?? "").trim();
  if (!venueId) return { error: "Missing venue id." };

  const role = String(formData.get("role") ?? "").trim() || null;
  const contactPhone = String(formData.get("contact_phone") ?? "").trim() || null;
  const contactEmailInput = String(formData.get("contact_email") ?? "").trim() || null;
  const reason = String(formData.get("reason") ?? "").trim() || null;

  // Look up the venue
  const { data: venue } = await supabase
    .from("venues")
    .select("id, name, slug, owner_id, city:cities(name, slug)")
    .eq("id", venueId)
    .single();
  if (!venue) return { error: "Venue not found." };

  // If it's already claimed, reject (admin can transfer ownership manually if needed)
  if (venue.owner_id) {
    return {
      error: "This venue already has an owner. Get in touch if you believe this is a mistake.",
    };
  }

  // Look up claimant profile for the notification email body
  const { data: profile } = await supabase
    .from("profiles")
    .select("display_name, email")
    .eq("id", user.id)
    .maybeSingle();

  // Insert the claim. The unique partial index on (venue_id, claimant_user_id) where
  // status='pending' prevents a single user spamming the same venue.
  const { error: insertErr } = await supabase
    .from("venue_claims")
    .insert({
      venue_id: venue.id,
      claimant_user_id: user.id,
      role,
      contact_phone: contactPhone,
      contact_email: contactEmailInput ?? user.email ?? null,
      reason,
      status: "pending",
    });
  if (insertErr) {
    if (insertErr.code === "23505") {
      return { error: "You already have a pending claim on this venue." };
    }
    return { error: insertErr.message };
  }

  // Notify admin
  notifyVenueClaim({
    venueName: venue.name,
    venueId: venue.id,
    citySlug: (venue.city as any)?.slug ?? null,
    venueSlug: venue.slug,
    claimantEmail: user.email ?? null,
    claimantName: profile?.display_name ?? null,
    role,
    contactPhone,
    reason,
  }).catch(() => {});

  revalidatePath(`/admin/queue`);
  revalidatePath(`/${(venue.city as any)?.slug ?? "dundee"}/venues/${venue.slug}`);
  return { ok: true, venueName: venue.name };
}
