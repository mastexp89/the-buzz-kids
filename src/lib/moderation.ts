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
import {
  notifyClaimApproved,
  notifyClaimRejected,
  notifyArtistClaimApproved,
  notifyArtistClaimRejected,
} from "@/lib/email";

export type ModerationResult =
  | { ok: true; label?: string; redundant?: boolean; paths?: string[] }
  | { error: string; hasExistingOwner?: boolean };

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

/**
 * Move a single event to a different place — the "wrong place?" fix for
 * events the importer matched (rather than created). Leaves status alone.
 */
export async function moveEventToVenueCore(
  _reviewerId: string,
  eventId: string,
  targetVenueId: string,
): Promise<
  | { ok: true; title: string; startTime: string; status: string; venueName: string; venueSlug: string | null; citySlug: string | null }
  | { error: string }
> {
  const sb = createServiceClient();
  const [{ data: ev }, { data: target }] = await Promise.all([
    sb.from("events").select("id, title, start_time, status, venue_id").eq("id", eventId).maybeSingle(),
    sb.from("venues").select("id, name, slug, city:cities(slug)").eq("id", targetVenueId).maybeSingle(),
  ]);
  if (!ev) return { error: "Event not found (already deleted?)." };
  if (!target) return { error: "Place not found." };
  if (ev.venue_id === targetVenueId) return { error: `Already at ${target.name}.` };

  const { error } = await sb.from("events").update({ venue_id: targetVenueId }).eq("id", eventId);
  if (error) return { error: error.message };

  return {
    ok: true,
    title: ev.title,
    startTime: ev.start_time,
    status: ev.status,
    venueName: target.name,
    venueSlug: target.slug ?? null,
    citySlug: (target as any).city?.slug ?? null,
  };
}

// ---------- Place claims (Take Ownership) ----------

export async function approveVenueClaimCore(
  reviewerId: string,
  claimId: string,
  opts: { transferFromExistingOwner?: boolean } = {},
): Promise<ModerationResult> {
  const sb = createServiceClient();

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
  const venue = claim.venue as any;
  const citySlug = venue?.city?.slug ?? "dundee";

  // Claimant already owns it (wizard + formal claim double-up) → just clear.
  if (existingOwnerId && existingOwnerId === claim.claimant_user_id) {
    const { error } = await sb
      .from("venue_claims")
      .update({ status: "approved", reviewed_at: new Date().toISOString(), reviewed_by: reviewerId })
      .eq("id", claimId);
    if (error) return { error: error.message };
    await sb
      .from("venue_claims")
      .update({
        status: "rejected",
        reviewed_at: new Date().toISOString(),
        reviewed_by: reviewerId,
        rejection_reason: "Another claim was approved first",
      })
      .eq("venue_id", claim.venue_id)
      .eq("status", "pending");
    return { ok: true, redundant: true, label: venue?.name ?? undefined };
  }

  if (existingOwnerId && !opts.transferFromExistingOwner) {
    return { error: "Place already has an owner.", hasExistingOwner: true };
  }

  const { error: vErr } = await sb
    .from("venues")
    .update({ owner_id: claim.claimant_user_id })
    .eq("id", claim.venue_id);
  if (vErr) return { error: vErr.message };

  const { error: cErr } = await sb
    .from("venue_claims")
    .update({ status: "approved", reviewed_at: new Date().toISOString(), reviewed_by: reviewerId })
    .eq("id", claimId);
  if (cErr) return { error: cErr.message };

  await sb
    .from("venue_claims")
    .update({
      status: "rejected",
      reviewed_at: new Date().toISOString(),
      reviewed_by: reviewerId,
      rejection_reason: "Another claim was approved first",
    })
    .eq("venue_id", claim.venue_id)
    .eq("status", "pending");

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

  if (claim.claimant_user_id && venue?.name) {
    await sendApprovalWelcomeMessage({
      userId: claim.claimant_user_id,
      kind: "venue",
      displayName: venue.name,
    });
  }

  return {
    ok: true,
    label: venue?.name ?? undefined,
    paths: [`/${citySlug}/venues/${venue?.slug}`],
  };
}

export async function rejectVenueClaimCore(
  reviewerId: string,
  claimId: string,
  reason?: string,
): Promise<ModerationResult> {
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
      reviewed_by: reviewerId,
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
    notifyClaimRejected({
      claimantEmail: email,
      venueName: (claim.venue as any)?.name ?? "your place",
      reason: reason ?? null,
    }).catch(() => {});
  }

  return { ok: true, label: (claim.venue as any)?.name ?? undefined };
}

// ---------- Provider (artist) page claims ----------

export async function approveArtistClaimCore(
  reviewerId: string,
  claimId: string,
): Promise<ModerationResult> {
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
    return { error: "Page already has an owner." };
  }

  const artist = claim.artist as any;

  const { error: aErr } = await sb
    .from("artists")
    .update({ claimed_by: claim.claimant_user_id })
    .eq("id", claim.artist_id);
  if (aErr) return { error: aErr.message };

  const { error: cErr } = await sb
    .from("artist_claims")
    .update({ status: "approved", reviewed_at: new Date().toISOString(), reviewed_by: reviewerId })
    .eq("id", claimId);
  if (cErr) return { error: cErr.message };

  await sb
    .from("artist_claims")
    .update({
      status: "rejected",
      reviewed_at: new Date().toISOString(),
      reviewed_by: reviewerId,
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

  return { ok: true, label: artist?.name ?? undefined, paths: [`/artists/${artist?.slug}`] };
}

export async function rejectArtistClaimCore(
  reviewerId: string,
  claimId: string,
  reason?: string,
): Promise<ModerationResult> {
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
      reviewed_by: reviewerId,
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
      artistName: (claim.artist as any)?.name ?? "your page",
      reason: reason ?? null,
    }).catch(() => {});
  }

  return { ok: true, label: (claim.artist as any)?.name ?? undefined };
}

// ---------- Edit suggestions + aggregator places ----------

export async function deleteSuggestionCore(_reviewerId: string, suggestionId: string): Promise<ModerationResult> {
  const sb = createServiceClient();
  const { data: s } = await sb.from("edit_suggestions").select("target_name").eq("id", suggestionId).maybeSingle();
  const { error } = await sb.from("edit_suggestions").delete().eq("id", suggestionId);
  if (error) return { error: error.message };
  return { ok: true, label: s?.target_name ?? undefined };
}

/**
 * One-tap "Add place" from an aggregator card: create the venue published
 * (name, region, website from the aggregator row), and let the half-hourly
 * enrich-venues cron backfill address/photos/hours. Skips creation when a
 * same-named approved venue already exists.
 */
export async function addAggregatorPlaceCore(_reviewerId: string, placeId: string): Promise<ModerationResult> {
  const sb = createServiceClient();
  const { data: p } = await sb
    .from("aggregator_places")
    .select("id, name, norm_name, location, website, city_slug, status")
    .eq("id", placeId)
    .maybeSingle();
  if (!p) return { error: "Place not found." };
  if (p.status !== "new") return { error: "Already handled." };

  // Already on the site under the same normalised name? Just clear the row.
  const { data: existing } = await sb
    .from("venues")
    .select("id, name")
    .eq("approved", true)
    .ilike("name", `%${(p.name.split(/\s+/)[0] ?? "").replace(/[%_]/g, "")}%`)
    .limit(20);
  const normName = (s: string) => (s || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
  const dupe = (existing ?? []).find((v) => normName(v.name) === normName(p.name));
  if (dupe) {
    await sb.from("aggregator_places").update({ status: "added" }).eq("id", placeId);
    return { ok: true, redundant: true, label: `${p.name} (already on the site)` };
  }

  const { data: city } = p.city_slug
    ? await sb.from("cities").select("id, slug").eq("slug", p.city_slug).maybeSingle()
    : { data: null as { id: string; slug: string } | null };

  const baseSlug = p.name.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-").replace(/-+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "place";
  let slug = baseSlug;
  let created: { id: string; slug: string } | null = null;
  for (let i = 0; i < 6 && !created; i++) {
    const { data: ins, error } = await sb
      .from("venues")
      .insert({
        name: p.name,
        slug,
        city_id: city?.id ?? null,
        address: p.location ?? null,
        website: p.website ?? null,
        approved: true,
        venue_type: "attraction",
        auto_imported: true,
      })
      .select("id, slug")
      .single();
    if (ins) { created = ins; break; }
    if (error?.code === "23505") { slug = `${baseSlug}-${i + 2}`; continue; }
    return { error: `Couldn't create place: ${error?.message ?? "unknown"}` };
  }
  if (!created) return { error: "Couldn't find a free slug for the place." };

  await sb.from("aggregator_places").update({ status: "added" }).eq("id", placeId);

  const citySlug = city?.slug ?? "dundee";
  return {
    ok: true,
    label: p.name,
    paths: [`/${citySlug}/venues/${created.slug}`, `/${citySlug}`],
  };
}

export async function dismissAggregatorPlaceCore(_reviewerId: string, placeId: string): Promise<ModerationResult> {
  const sb = createServiceClient();
  const { data: p } = await sb.from("aggregator_places").select("name").eq("id", placeId).maybeSingle();
  if (!p) return { error: "Place not found." };
  const { error } = await sb.from("aggregator_places").update({ status: "dismissed" }).eq("id", placeId);
  if (error) return { error: error.message };
  return { ok: true, label: p.name ?? undefined };
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
