"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { notifyArtistClaim } from "@/lib/email";

export type SubmitArtistClaimResult =
  | { ok: true; artistName: string }
  | { error: string };

export async function submitArtistClaim(
  formData: FormData,
): Promise<SubmitArtistClaimResult> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "You need to be signed in to claim an artist page." };

  const artistId = String(formData.get("artist_id") ?? "").trim();
  if (!artistId) return { error: "Missing artist id." };

  const role = String(formData.get("role") ?? "").trim() || null;
  const contactPhone = String(formData.get("contact_phone") ?? "").trim() || null;
  const contactEmailInput = String(formData.get("contact_email") ?? "").trim() || null;
  const reason = String(formData.get("reason") ?? "").trim() || null;

  const { data: artist } = await supabase
    .from("artists")
    .select("id, name, slug, claimed_by")
    .eq("id", artistId)
    .single();
  if (!artist) return { error: "Artist not found." };

  if (artist.claimed_by) {
    return {
      error: "This artist page already has an owner. Get in touch if you believe this is a mistake.",
    };
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("display_name, email")
    .eq("id", user.id)
    .maybeSingle();

  const { error: insertErr } = await supabase
    .from("artist_claims")
    .insert({
      artist_id: artist.id,
      claimant_user_id: user.id,
      role,
      contact_phone: contactPhone,
      contact_email: contactEmailInput ?? user.email ?? null,
      reason,
      status: "pending",
    });
  if (insertErr) {
    if (insertErr.code === "23505") {
      return { error: "You already have a pending claim on this artist." };
    }
    return { error: insertErr.message };
  }

  notifyArtistClaim({
    artistName: artist.name,
    artistId: artist.id,
    artistSlug: artist.slug,
    claimantEmail: user.email ?? null,
    claimantName: profile?.display_name ?? null,
    role,
    contactPhone,
    reason,
  }).catch(() => {});

  revalidatePath("/admin/queue");
  revalidatePath(`/artists/${artist.slug}`);
  return { ok: true, artistName: artist.name };
}
