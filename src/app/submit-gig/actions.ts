"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { slugify } from "@/lib/utils";
import {
  notifyVenueSuggestion,
  notifyPendingGig,
  notifyVenueOwnerOfPendingGig,
  notifyNewArtist,
} from "@/lib/email";

function parseDateTimeLocal(s: string): string | null {
  if (!s) return null;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

// Auto-created artists are unapproved until an admin OKs them.
// Real claimed artists go through a separate flow.
async function resolveArtistNames(
  supabase: Awaited<ReturnType<typeof createClient>>,
  names: string[],
  submitterEmail: string | null = null
): Promise<string[]> {
  const cleaned = Array.from(
    new Set(names.map((n) => n.trim()).filter((n) => n.length > 0 && n.length <= 80))
  );
  if (cleaned.length === 0) return [];

  const ids: string[] = [];
  for (const name of cleaned) {
    const slug = slugify(name);
    if (!slug) continue;
    const { data: existing } = await supabase
      .from("artists")
      .select("id")
      .eq("slug", slug)
      .maybeSingle();
    if (existing) {
      ids.push(existing.id);
      continue;
    }
    const { data: created, error } = await supabase
      .from("artists")
      .insert({ name, slug, approved: false })
      .select("id")
      .single();
    if (!error && created) {
      ids.push(created.id);
      // fire-and-forget admin notification
      notifyNewArtist({ artistId: created.id, artistName: name, claimerEmail: submitterEmail }).catch(() => {});
    }
  }
  return ids;
}

export type SubmitGigResult =
  | { ok: true; kind: "pending_listed"; venueName: string }
  | { ok: true; kind: "approved_listed"; venueName: string; venueSlug: string; citySlug: string }
  | { ok: true; kind: "pending_unlisted"; venueName: string }
  | { error: string };

export async function submitGig(formData: FormData): Promise<SubmitGigResult> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "You need to be signed in to submit a gig." };

  // Honeypot — if this field is filled, it's a bot. Pretend success.
  const honeypot = String(formData.get("website2") ?? "").trim();
  if (honeypot) {
    return { ok: true, kind: "pending_listed", venueName: "thanks" };
  }

  const venueId = String(formData.get("venue_id") ?? "").trim() || null;
  const newVenueName = String(formData.get("new_venue_name") ?? "").trim();
  const newVenueCityId = String(formData.get("new_venue_city_id") ?? "").trim() || null;
  const newVenueAddress = String(formData.get("new_venue_address") ?? "").trim() || null;
  const newVenuePostcode = String(formData.get("new_venue_postcode") ?? "").trim() || null;
  const newVenueWebsite = String(formData.get("new_venue_website") ?? "").trim() || null;

  const title = String(formData.get("title") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim() || null;
  const start_time = parseDateTimeLocal(String(formData.get("start_time") ?? ""));
  const end_time = parseDateTimeLocal(String(formData.get("end_time") ?? ""));
  const cover_charge = String(formData.get("cover_charge") ?? "").trim() || null;
  const ticket_url = String(formData.get("ticket_url") ?? "").trim() || null;
  const image_url = String(formData.get("image_url") ?? "").trim() || null;
  const genreIds = formData.getAll("genres").map(String).filter(Boolean);
  const existingArtistIds = formData.getAll("artist_ids").map(String).filter(Boolean);
  const newArtistNames = formData.getAll("new_artist_names").map(String).filter(Boolean);
  // Optional: artist's own name to auto-tag themselves
  const selfArtistName = String(formData.get("self_artist_name") ?? "").trim();
  // Contact info for venue suggestion follow-up
  const submitterName = String(formData.get("submitter_name") ?? "").trim() || null;
  const submitterContact = String(formData.get("submitter_contact") ?? "").trim() || null;

  if (!title || !start_time) {
    return { error: "Title and start time are required." };
  }

  // ----- Path A: existing/listed venue -----
  if (venueId) {
    const { data: venue } = await supabase
      .from("venues")
      .select("id, name, slug, approved, owner_id, city:cities(slug)")
      .eq("id", venueId)
      .single();
    if (!venue) return { error: "That venue could not be found." };

    // If the venue has no owner (unclaimed / auto-imported), the gig auto-approves
    // and goes live immediately. If there's an owner, it still needs their approval.
    const autoApprove = !venue.owner_id;
    const status = autoApprove ? "approved" : "pending";

    // Dedupe: refuse to insert if an event with an overlapping title already
    // exists at this venue at the same start hour. Catches artists submitting
    // a gig the venue or scraper has already listed.
    const startHour = startHourKey(start_time);
    const normNew = normaliseTitle(title);
    const { data: existingEvents } = await supabase
      .from("events")
      .select("id, title, start_time")
      .eq("venue_id", venue.id)
      .neq("status", "rejected");
    const overlap = (existingEvents ?? []).find((e: any) => {
      if (startHourKey(e.start_time) !== startHour) return false;
      const nt = normaliseTitle(e.title);
      if (nt === normNew) return true;
      if (nt.length >= 6 && normNew.length >= 6 && (nt.includes(normNew) || normNew.includes(nt))) return true;
      return false;
    });
    if (overlap) {
      return {
        error: "A gig with this title is already listed at this venue at this time. If yours is different, tweak the title slightly.",
      };
    }

    const { data: created, error } = await supabase
      .from("events")
      .insert({
        venue_id: venue.id,
        title,
        description,
        start_time,
        end_time,
        cover_charge,
        ticket_url,
        image_url,
        status,
        submitted_by: user.id,
      })
      .select("id")
      .single();
    if (error) return { error: error.message };

    if (genreIds.length) {
      await supabase.from("event_genres").insert(
        genreIds.map((gid) => ({ event_id: created.id, genre_id: gid }))
      );
    }

    const artistNamesToCreate = [...newArtistNames];
    if (selfArtistName) artistNamesToCreate.push(selfArtistName);
    const newArtistIds = artistNamesToCreate.length > 0
      ? await resolveArtistNames(supabase, artistNamesToCreate, user.email ?? null)
      : [];
    const allArtistIds = Array.from(new Set([...existingArtistIds, ...newArtistIds]));
    if (allArtistIds.length) {
      await supabase.from("event_artists").insert(
        allArtistIds.map((aid) => ({ event_id: created.id, artist_id: aid }))
      );
    }

    // Notify admin (FYI for auto-approved, action-needed for pending)
    notifyPendingGig({
      venueName: venue.name,
      venueOwnerEmail: null,
      gigTitle: title,
      startTime: start_time,
      submitterEmail: user.email ?? null,
      venueId: venue.id,
    }).catch(() => {});

    // Only ping the venue owner if there is one AND the gig is awaiting approval
    if (!autoApprove && venue.owner_id) {
      const { data: ownerProfile } = await supabase
        .from("profiles")
        .select("email")
        .eq("id", venue.owner_id)
        .maybeSingle();
      if (ownerProfile?.email) {
        notifyVenueOwnerOfPendingGig({
          venueOwnerEmail: ownerProfile.email,
          venueName: venue.name,
          gigTitle: title,
          startTime: start_time,
          venueId: venue.id,
        }).catch(() => {});
      }

      // Push notification alongside the email — lands on the mobile app's
      // approval queue. Best-effort; never blocks the submission flow.
      const { sendPushToUser } = await import("@/lib/push");
      void sendPushToUser(venue.owner_id, {
        title: "New gig to approve",
        body: `${title} at ${venue.name} — tap to review`,
        data: {
          type: "gig_submitted",
          venueId: venue.id,
          eventId: created.id,
        },
      });
    }

    revalidatePath(`/dashboard/venues/${venue.id}`);
    if (autoApprove) {
      const citySlug = (venue as any).city?.slug ?? "dundee";
      revalidatePath(`/${citySlug}/venues/${venue.slug}`);
      revalidatePath(`/${citySlug}`);
      return {
        ok: true,
        kind: "approved_listed",
        venueName: venue.name,
        venueSlug: venue.slug,
        citySlug,
      };
    }
    return { ok: true, kind: "pending_listed", venueName: venue.name };
  }

  // ----- Path B: unlisted venue suggestion -----
  if (!newVenueName) {
    return { error: "Pick a venue from the list, or type the venue name." };
  }

  // Compact "extras" into a JSON blob the admin/venue can review later.
  const extras = {
    genre_ids: genreIds,
    existing_artist_ids: existingArtistIds,
    new_artist_names: newArtistNames,
    self_artist_name: selfArtistName || null,
  };

  const { error: sugErr } = await supabase
    .from("venue_suggestions")
    .insert({
      submitted_by: user.id,
      venue_name: newVenueName,
      city_id: newVenueCityId,
      address: newVenueAddress,
      postcode: newVenuePostcode,
      website: newVenueWebsite,
      gig_title: title,
      gig_start_time: start_time,
      gig_end_time: end_time,
      gig_cover_charge: cover_charge,
      gig_ticket_url: ticket_url,
      gig_image_url: image_url,
      gig_description: description,
      submitter_name: submitterName,
      submitter_contact: submitterContact,
      extras,
      status: "pending",
    });
  if (sugErr) return { error: sugErr.message };

  // Look up city name for the email
  let cityName: string | null = null;
  if (newVenueCityId) {
    const { data: c } = await supabase.from("cities").select("name").eq("id", newVenueCityId).maybeSingle();
    cityName = c?.name ?? null;
  }
  notifyVenueSuggestion({
    venueName: newVenueName,
    cityName,
    gigTitle: title,
    submitterEmail: user.email ?? null,
    submitterContact: submitterContact,
  }).catch(() => {});

  return { ok: true, kind: "pending_unlisted", venueName: newVenueName };
}


function normaliseTitle(t: string): string {
  return (t || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function startHourKey(iso: string): string {
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}T${pad(t.getUTCHours())}`;
}
