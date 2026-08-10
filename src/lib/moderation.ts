// Approve/reject cores callable without a web session — used by the
// Telegram bot webhook (/api/telegram/webhook). Each takes the reviewer's
// profile id explicitly and uses the service-role client. Callers handle
// revalidatePath for their own context.
//
// The web admin actions in src/app/admin/queue/actions.ts, src/lib/
// reviews-actions.ts and src/app/admin/suggestions/actions.ts keep their
// own (session-authenticated) implementations; these cores mirror them —
// if one of those actions gains side effects, mirror the change here.

import { createServiceClient } from "@/lib/supabase/service";
import { sendApprovalWelcomeMessage } from "@/lib/welcome-message";

export type ModerationResult =
  | { ok: true; label?: string }
  | { error: string };

/**
 * Reviewer attribution for Telegram-side actions: the oldest admin
 * profile. The Telegram confirmation message records which group member
 * actually pressed the button.
 */
export async function resolveDefaultReviewerId(): Promise<string | null> {
  const sb = createServiceClient();
  const { data } = await sb
    .from("profiles")
    .select("id")
    .eq("role", "admin")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  return data?.id ?? null;
}

export async function approveEventCore(reviewerId: string, eventId: string): Promise<ModerationResult> {
  const sb = createServiceClient();
  const { error } = await sb
    .from("events")
    .update({
      status: "approved",
      reviewed_at: new Date().toISOString(),
      reviewed_by: reviewerId,
    })
    .eq("id", eventId);
  if (error) return { error: error.message };
  const { data: ev } = await sb.from("events").select("title").eq("id", eventId).maybeSingle();
  return { ok: true, label: ev?.title ?? undefined };
}

export async function rejectEventCore(reviewerId: string, eventId: string): Promise<ModerationResult> {
  const sb = createServiceClient();
  const { error } = await sb
    .from("events")
    .update({
      status: "rejected",
      reviewed_at: new Date().toISOString(),
      reviewed_by: reviewerId,
    })
    .eq("id", eventId);
  if (error) return { error: error.message };
  const { data: ev } = await sb.from("events").select("title").eq("id", eventId).maybeSingle();
  return { ok: true, label: ev?.title ?? undefined };
}

export async function approveArtistCore(_reviewerId: string, artistId: string): Promise<ModerationResult> {
  const sb = createServiceClient();
  const { error } = await sb.from("artists").update({ approved: true }).eq("id", artistId);
  if (error) return { error: error.message };

  const { data: artist } = await sb
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
  return { ok: true, label: artist?.name ?? undefined };
}

export async function approveVenueCore(_reviewerId: string, venueId: string): Promise<ModerationResult> {
  const sb = createServiceClient();
  const { error } = await sb.from("venues").update({ approved: true }).eq("id", venueId);
  if (error) return { error: error.message };
  const { data: v } = await sb.from("venues").select("name").eq("id", venueId).maybeSingle();
  return { ok: true, label: v?.name ?? undefined };
}

export async function approveOrganiserCore(_reviewerId: string, organiserId: string): Promise<ModerationResult> {
  const sb = createServiceClient();
  const { error } = await sb.from("organisers").update({ approved: true }).eq("id", organiserId);
  if (error) return { error: error.message };
  const { data: o } = await sb.from("organisers").select("name").eq("id", organiserId).maybeSingle();
  return { ok: true, label: o?.name ?? undefined };
}

/**
 * Approve a place the /event poster importer created, together with the
 * pending events that came off the poster.
 */
export async function approveVenueWithGigsCore(reviewerId: string, venueId: string): Promise<ModerationResult> {
  const sb = createServiceClient();
  const { error: vErr } = await sb.from("venues").update({ approved: true }).eq("id", venueId);
  if (vErr) return { error: vErr.message };
  const { error: eErr } = await sb
    .from("events")
    .update({
      status: "approved",
      reviewed_at: new Date().toISOString(),
      reviewed_by: reviewerId,
    })
    .eq("venue_id", venueId)
    .eq("status", "pending");
  if (eErr) return { error: eErr.message };
  const { data: v } = await sb.from("venues").select("name").eq("id", venueId).maybeSingle();
  return { ok: true, label: v?.name ?? undefined };
}

/**
 * Bin a place the poster importer created (plus its events). Guarded so it
 * can ONLY delete an unapproved auto-imported place — a stale button press
 * after the place went live is a no-op error, never a delete.
 */
export async function discardImportedVenueCore(_reviewerId: string, venueId: string): Promise<ModerationResult> {
  const sb = createServiceClient();
  const { data: v } = await sb
    .from("venues")
    .select("id, name, approved, auto_imported")
    .eq("id", venueId)
    .maybeSingle();
  if (!v) return { error: "Place not found (already discarded?)." };
  if (v.approved || !v.auto_imported) {
    return { error: "Not discardable — place is live or wasn't created by the poster importer." };
  }
  const { data: events } = await sb.from("events").select("id").eq("venue_id", venueId);
  const eventIds = (events ?? []).map((e) => e.id);
  if (eventIds.length > 0) {
    await sb.from("event_artists").delete().in("event_id", eventIds);
    await sb.from("event_genres").delete().in("event_id", eventIds);
    await sb.from("events").delete().in("id", eventIds);
  }
  const { error } = await sb.from("venues").delete().eq("id", venueId);
  if (error) return { error: error.message };
  return { ok: true, label: v.name ?? undefined };
}

/**
 * "Did you mean…?" resolution: move the events off a place the poster
 * importer created and onto an existing place, then delete the imported
 * stub. Events stay pending — the webhook posts per-event Approve cards.
 */
export async function reassignImportedEventsCore(
  _reviewerId: string,
  importedVenueId: string,
  targetVenueId: string,
): Promise<
  | { ok: true; targetName: string; moved: { id: string; title: string; start_time: string }[] }
  | { error: string }
> {
  const sb = createServiceClient();
  const [{ data: imported }, { data: target }] = await Promise.all([
    sb.from("venues").select("id, name, approved, auto_imported").eq("id", importedVenueId).maybeSingle(),
    sb.from("venues").select("id, name").eq("id", targetVenueId).maybeSingle(),
  ]);
  if (!imported) return { error: "Imported place not found (already handled?)." };
  if (imported.approved || !imported.auto_imported) {
    return { error: "Not movable — place is live or wasn't created by the poster importer." };
  }
  if (!target) return { error: "Target place not found." };

  const { data: moved, error: mvErr } = await sb
    .from("events")
    .update({ venue_id: targetVenueId })
    .eq("venue_id", importedVenueId)
    .select("id, title, start_time");
  if (mvErr) return { error: mvErr.message };

  const { error: delErr } = await sb.from("venues").delete().eq("id", importedVenueId);
  if (delErr) return { error: delErr.message };

  return { ok: true, targetName: target.name, moved: moved ?? [] };
}

export async function setReviewStatusCore(
  _reviewerId: string,
  reviewId: string,
  status: "approved" | "hidden",
): Promise<ModerationResult> {
  const sb = createServiceClient();
  const { error } = await sb.from("reviews").update({ status }).eq("id", reviewId);
  if (error) return { error: error.message };
  const { data: r } = await sb
    .from("reviews")
    .select("title, venue:venues(name)")
    .eq("id", reviewId)
    .maybeSingle();
  const label = (r as any)?.venue?.name ?? (r as any)?.title ?? undefined;
  return { ok: true, label };
}

export async function setSuggestionStatusCore(
  _reviewerId: string,
  suggestionId: string,
  status: "new" | "done",
): Promise<ModerationResult> {
  const sb = createServiceClient();
  const { error } = await sb.from("edit_suggestions").update({ status }).eq("id", suggestionId);
  if (error) return { error: error.message };
  const { data: s } = await sb
    .from("edit_suggestions")
    .select("target_name")
    .eq("id", suggestionId)
    .maybeSingle();
  return { ok: true, label: s?.target_name ?? undefined };
}
