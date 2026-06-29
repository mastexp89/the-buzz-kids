"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
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
  role: "venue_owner" | "artist" | "event_organiser" | "admin" | "editor",
) {
  const { supabase, ok, currentUserId } = await requireAdmin();
  if (!ok) return { error: "Not authorised." };
  if (userId === currentUserId && role !== "admin") {
    return { error: "You can't demote yourself. Ask another admin to do it." };
  }
  if (!["venue_owner", "artist", "event_organiser", "admin", "editor"].includes(role)) {
    return { error: "Invalid role." };
  }
  const { error } = await supabase.from("profiles").update({ role }).eq("id", userId);
  if (error) return { error: error.message };
  revalidatePath("/admin");
  return { ok: true };
}

// Super-admin: create a user account directly (e.g. to set up an editor /
// contributor without them having to sign up first). The account is created
// already-confirmed, so they can log in straight away with the password set.
export async function createUserAccount(input: {
  email: string;
  password: string;
  displayName?: string;
  role: "parent" | "editor" | "admin";
}): Promise<{ ok?: true; error?: string }> {
  const { ok } = await requireAdmin();
  if (!ok) return { error: "Not authorised." };

  const email = (input.email ?? "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: "Enter a valid email address." };
  if (!input.password || input.password.length < 8) return { error: "Password must be at least 8 characters." };
  const displayName = (input.displayName ?? "").trim() || null;

  // The chosen account maps to a profile role + a signup account_type.
  // Parents are plain 'user' accounts (account_type 'fan'); 'fan' is not a
  // valid profile role, so don't write it as one.
  const choice = ["parent", "editor", "admin"].includes(input.role) ? input.role : "parent";
  const role = choice === "parent" ? "user" : choice; // 'user' | 'editor' | 'admin'
  const accountType = choice === "parent" ? "fan" : choice;

  const svc = createServiceClient();
  const { data, error } = await svc.auth.admin.createUser({
    email,
    password: input.password,
    email_confirm: true,
    user_metadata: { display_name: displayName ?? "", account_type: accountType },
  });
  if (error) {
    if (/already.*registered|exists/i.test(error.message)) return { error: "An account with that email already exists." };
    return { error: error.message };
  }
  // Override the profile with the chosen role + name (the signup trigger may
  // default these from metadata; make sure they match what was picked here).
  const { error: profErr } = await svc
    .from("profiles")
    .upsert({ id: data.user.id, email, display_name: displayName, role });
  if (profErr) {
    return { error: `Account created, but setting the role failed: ${profErr.message}. Set it from the user list.` };
  }

  revalidatePath("/admin");
  return { ok: true };
}
