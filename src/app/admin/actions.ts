"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { sendAdminEmail } from "@/lib/email";
import { sendApprovalWelcomeMessage } from "@/lib/welcome-message";

async function requireAdmin() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { supabase, ok: false as const, currentUserId: null };
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();
  return { supabase, ok: profile?.role === "admin", currentUserId: user.id };
}

export async function approveVenue(venueId: string) {
  const { supabase, ok } = await requireAdmin();
  if (!ok) return { error: "Not authorised." };
  const { error } = await supabase.from("venues").update({ approved: true }).eq("id", venueId);
  if (error) return { error: error.message };

  // Drop a welcome message into the owner's in-app message thread —
  // turns approval into an open support channel they can reply to.
  // Only when the venue actually has an owner; auto-imported / unclaimed
  // venues approved by admin don't have anyone to message.
  const { data: venue } = await supabase
    .from("venues")
    .select("name, owner_id")
    .eq("id", venueId)
    .maybeSingle();
  if (venue?.owner_id && venue.name) {
    await sendApprovalWelcomeMessage({
      userId: venue.owner_id,
      kind: "venue",
      displayName: venue.name,
    });
  }

  revalidatePath("/admin");
  return { ok: true };
}

export async function unapproveVenue(venueId: string) {
  const { supabase, ok } = await requireAdmin();
  if (!ok) return { error: "Not authorised." };
  const { error } = await supabase.from("venues").update({ approved: false }).eq("id", venueId);
  if (error) return { error: error.message };
  revalidatePath("/admin");
  return { ok: true };
}

export type ExpireEventResult = { error: string } | { ok: true };

/**
 * Force-expire an event by setting its end_time to right now. Used when
 * admin knows an event is finished but the system can't tell because no
 * end_time was set originally — the event would otherwise stick around
 * in listings until end-of-day. Setting end_time=now means the
 * effectiveEndTime filter immediately treats it as past and hides it.
 */
export async function expireEventNow(eventId: string): Promise<ExpireEventResult> {
  const { supabase, ok } = await requireAdmin();
  if (!ok) return { error: "Not authorised." };
  const nowIso = new Date().toISOString();
  const { error } = await supabase
    .from("events")
    .update({ end_time: nowIso })
    .eq("id", eventId);
  if (error) return { error: error.message };
  // Bust caches on every page that might surface the event.
  revalidatePath("/");
  revalidatePath("/dundee");
  revalidatePath("/angus");
  revalidatePath(`/admin`);
  return { ok: true };
}

// Organiser approval actions — same shape as venue approval.
export async function approveOrganiser(organiserId: string) {
  const { supabase, ok } = await requireAdmin();
  if (!ok) return { error: "Not authorised." };
  const { error } = await supabase
    .from("organisers")
    .update({ approved: true })
    .eq("id", organiserId);
  if (error) return { error: error.message };

  // Welcome message into the claimer's in-app thread.
  const { data: organiser } = await supabase
    .from("organisers")
    .select("name, claimed_by")
    .eq("id", organiserId)
    .maybeSingle();
  if (organiser?.claimed_by && organiser.name) {
    await sendApprovalWelcomeMessage({
      userId: organiser.claimed_by,
      kind: "organiser",
      displayName: organiser.name,
    });
  }

  revalidatePath("/admin");
  revalidatePath("/admin/queue");
  return { ok: true };
}

export async function unapproveOrganiser(organiserId: string) {
  const { supabase, ok } = await requireAdmin();
  if (!ok) return { error: "Not authorised." };
  const { error } = await supabase
    .from("organisers")
    .update({ approved: false })
    .eq("id", organiserId);
  if (error) return { error: error.message };
  revalidatePath("/admin");
  revalidatePath("/admin/queue");
  return { ok: true };
}

export async function deleteVenueAdmin(venueId: string) {
  const { supabase, ok } = await requireAdmin();
  if (!ok) return { error: "Not authorised." };
  // Best-effort: clean child tables first in case FK cascade isn't set up.
  // Events first (and their child rows via cascade), then the venue itself.
  const { data: events } = await supabase.from("events").select("id").eq("venue_id", venueId);
  const eventIds = (events ?? []).map((e) => e.id);
  if (eventIds.length > 0) {
    await supabase.from("event_artists").delete().in("event_id", eventIds);
    await supabase.from("event_genres").delete().in("event_id", eventIds);
    await supabase.from("events").delete().in("id", eventIds);
  }
  const { error } = await supabase.from("venues").delete().eq("id", venueId);
  if (error) return { error: error.message };
  revalidatePath("/admin");
  return { ok: true };
}

export async function messageVenueOwner(
  venueId: string,
  subject: string,
  body: string,
) {
  const { supabase, ok } = await requireAdmin();
  if (!ok) return { error: "Not authorised." };

  const trimmedSubject = subject.trim();
  const trimmedBody = body.trim();
  if (!trimmedSubject) return { error: "Subject is required." };
  if (!trimmedBody) return { error: "Message body is required." };
  if (trimmedSubject.length > 200)
    return { error: "Subject must be 200 characters or fewer." };
  if (trimmedBody.length > 10000)
    return { error: "Message body must be 10,000 characters or fewer." };

  const { data: venue } = await supabase
    .from("venues")
    .select("id, name, owner:profiles!owner_id(email, display_name)")
    .eq("id", venueId)
    .maybeSingle();

  const ownerEmail = (venue as any)?.owner?.email as string | undefined;
  if (!venue) return { error: "Venue not found." };
  if (!ownerEmail) return { error: "This venue has no owner email on file." };

  const adminReplyTo =
    process.env.ADMIN_NOTIFY_EMAIL ?? "hello@thebuzzkids.co.uk";

  const sent = await sendAdminEmail({
    to: ownerEmail,
    replyTo: adminReplyTo,
    subject: trimmedSubject,
    text:
      trimmedBody +
      `\n\n— The Buzz Kids team\nReply to this email to reach us at ${adminReplyTo}.`,
  });

  if (!sent)
    return {
      error: "Email failed to send. Check Resend credentials and try again.",
    };

  return { ok: true };
}

// ---------- Bulk venue actions ----------

export async function bulkApproveVenues(ids: string[]) {
  const { supabase, ok } = await requireAdmin();
  if (!ok) return { error: "Not authorised." };
  if (!Array.isArray(ids) || ids.length === 0) return { error: "No venues selected." };
  const { error } = await supabase
    .from("venues")
    .update({ approved: true })
    .in("id", ids);
  if (error) return { error: error.message };
  revalidatePath("/admin");
  return { ok: true, count: ids.length };
}

export async function bulkUnapproveVenues(ids: string[]) {
  const { supabase, ok } = await requireAdmin();
  if (!ok) return { error: "Not authorised." };
  if (!Array.isArray(ids) || ids.length === 0) return { error: "No venues selected." };
  const { error } = await supabase
    .from("venues")
    .update({ approved: false })
    .in("id", ids);
  if (error) return { error: error.message };
  revalidatePath("/admin");
  return { ok: true, count: ids.length };
}

export async function bulkDeleteVenues(ids: string[]) {
  const { supabase, ok } = await requireAdmin();
  if (!ok) return { error: "Not authorised." };
  if (!Array.isArray(ids) || ids.length === 0) return { error: "No venues selected." };

  // Same cascade as the single delete — best-effort cleanup of child tables
  const { data: events } = await supabase
    .from("events")
    .select("id")
    .in("venue_id", ids);
  const eventIds = (events ?? []).map((e) => e.id);
  if (eventIds.length > 0) {
    await supabase.from("event_artists").delete().in("event_id", eventIds);
    await supabase.from("event_genres").delete().in("event_id", eventIds);
    await supabase.from("events").delete().in("id", eventIds);
  }
  const { error } = await supabase.from("venues").delete().in("id", ids);
  if (error) return { error: error.message };
  revalidatePath("/admin");
  return { ok: true, count: ids.length };
}

export async function setUserRole(
  userId: string,
  role: "venue_owner" | "artist" | "event_organiser" | "admin",
) {
  const { supabase, ok, currentUserId } = await requireAdmin();
  if (!ok) return { error: "Not authorised." };
  if (userId === currentUserId && role !== "admin") {
    return { error: "You can't demote yourself. Ask another admin to do it." };
  }
  if (!["venue_owner", "artist", "event_organiser", "admin"].includes(role)) {
    return { error: "Invalid role." };
  }
  const { error } = await supabase.from("profiles").update({ role }).eq("id", userId);
  if (error) return { error: error.message };
  revalidatePath("/admin");
  return { ok: true };
}
