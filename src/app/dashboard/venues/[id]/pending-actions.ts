"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { sendPushToUser } from "@/lib/push";

async function ownsVenue(venueId: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: venue } = await supabase
    .from("venues")
    .select("id, owner_id")
    .eq("id", venueId)
    .single();
  if (!venue || venue.owner_id !== user.id) {
    // Allow admins too
    const { data: prof } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
    if (prof?.role !== "admin") return null;
  }
  return { supabase, user };
}

export async function approvePendingGig(eventId: string, venueId: string) {
  const ctx = await ownsVenue(venueId);
  if (!ctx) return { error: "Not authorised." };
  const { supabase, user } = ctx;

  const { error } = await supabase
    .from("events")
    .update({
      status: "approved",
      reviewed_at: new Date().toISOString(),
      reviewed_by: user.id,
    })
    .eq("id", eventId)
    .eq("venue_id", venueId);
  if (error) return { error: error.message };

  // Push the submitter — "your gig was approved!" The submitter is the
  // user who created the pending event (events.submitted_by). Use the
  // service client so we don't depend on the approver's RLS reach over
  // submitter data. Best-effort: any failure here doesn't roll back the
  // approval itself.
  try {
    const admin = createServiceClient();
    const { data: ev } = await admin
      .from("events")
      .select("title, submitted_by, venue:venues(name)")
      .eq("id", eventId)
      .maybeSingle();
    const submittedBy = (ev as any)?.submitted_by as string | null | undefined;
    if (submittedBy && submittedBy !== user.id) {
      const venueName = (ev as any)?.venue?.name ?? "the venue";
      const title = "Your gig was approved 🎉";
      const body = `${(ev as any)?.title ?? "Your event"} is now live at ${venueName}`;
      void sendPushToUser(submittedBy, {
        title,
        body,
        data: { type: "gig_approved", eventId },
      });
    }
  } catch { /* push is best-effort */ }

  revalidatePath(`/dashboard/venues/${venueId}`);
  return { ok: true };
}

export async function rejectPendingGig(eventId: string, venueId: string) {
  const ctx = await ownsVenue(venueId);
  if (!ctx) return { error: "Not authorised." };
  const { supabase, user } = ctx;

  const { error } = await supabase
    .from("events")
    .update({
      status: "rejected",
      reviewed_at: new Date().toISOString(),
      reviewed_by: user.id,
    })
    .eq("id", eventId)
    .eq("venue_id", venueId);
  if (error) return { error: error.message };

  revalidatePath(`/dashboard/venues/${venueId}`);
  return { ok: true };
}
