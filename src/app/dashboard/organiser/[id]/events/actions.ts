"use server";

// Organiser event management — take ownership of existing events, add
// new events (which default to status='pending' so admin reviews each
// one — anti-spam gate).

import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { revalidatePath } from "next/cache";

type OwnerCtx = {
  user: { id: string; email?: string | null };
  sb: ReturnType<typeof createServiceClient>;
  organiser: { id: string; name: string; claimed_by: string | null };
};

async function requireOrganiserOwner(
  organiserId: string,
): Promise<{ error: string } | OwnerCtx> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };
  const sb = createServiceClient();
  const { data: organiser } = await sb
    .from("organisers")
    .select("id, name, claimed_by")
    .eq("id", organiserId)
    .maybeSingle();
  if (!organiser) return { error: "Organiser not found." };
  const { data: profile } = await sb
    .from("profiles").select("role").eq("id", user.id).maybeSingle();
  const isAdmin = profile?.role === "admin";
  if (!isAdmin && organiser.claimed_by !== user.id) {
    return { error: "Not authorised." };
  }
  return { user, sb, organiser };
}

export type EventLite = {
  id: string;
  title: string;
  start_time: string;
  status: string | null;
  cancelled: boolean;
  venueName: string;
  venueSlug: string;
  citySlug: string | null;
};

export async function listOrganiserEvents(organiserId: string): Promise<{ error: string } | { ok: true; events: EventLite[] }> {
  const ctx = await requireOrganiserOwner(organiserId);
  if ("error" in ctx) return { error: ctx.error };

  const { data: rows } = await ctx.sb
    .from("event_organisers")
    .select(
      `event:events(id, title, start_time, status, cancelled, venue:venues(name, slug, city:cities(slug)))`,
    )
    .eq("organiser_id", organiserId);

  const events: EventLite[] = (rows ?? [])
    .map((r: any) => r.event)
    .filter(Boolean)
    .map((e: any) => ({
      id: e.id,
      title: e.title,
      start_time: e.start_time,
      status: e.status ?? null,
      cancelled: !!e.cancelled,
      venueName: e.venue?.name ?? "—",
      venueSlug: e.venue?.slug ?? "",
      citySlug: e.venue?.city?.slug ?? null,
    }))
    .sort((a, b) => b.start_time.localeCompare(a.start_time));

  return { ok: true, events };
}

export async function searchEventsToTakeOwnership(
  organiserId: string,
  query: string,
): Promise<{ error: string } | { ok: true; events: EventLite[] }> {
  const ctx = await requireOrganiserOwner(organiserId);
  if ("error" in ctx) return { error: ctx.error };
  const q = query.trim();
  if (q.length < 2) return { ok: true, events: [] };

  // Find events the organiser ISN'T already linked to. Two-step: get
  // already-linked event IDs, then query events excluding those.
  const { data: linkedRows } = await ctx.sb
    .from("event_organisers")
    .select("event_id")
    .eq("organiser_id", organiserId);
  const linkedIds = new Set((linkedRows ?? []).map((r: any) => r.event_id));

  const nowIso = new Date().toISOString();
  const { data: matches } = await ctx.sb
    .from("events")
    .select("id, title, start_time, status, cancelled, venue:venues(name, slug, city:cities(slug))")
    .ilike("title", `%${q.replace(/[%_]/g, "")}%`)
    .gte("start_time", nowIso)
    .neq("status", "rejected")
    .order("start_time", { ascending: true })
    .limit(30);

  const events: EventLite[] = (matches ?? [])
    .filter((e: any) => !linkedIds.has(e.id))
    .map((e: any) => ({
      id: e.id,
      title: e.title,
      start_time: e.start_time,
      status: e.status ?? null,
      cancelled: !!e.cancelled,
      venueName: e.venue?.name ?? "—",
      venueSlug: e.venue?.slug ?? "",
      citySlug: e.venue?.city?.slug ?? null,
    }));

  return { ok: true, events };
}

export async function takeOwnershipOfEvent(
  organiserId: string,
  eventId: string,
): Promise<{ error: string } | { ok: true }> {
  const ctx = await requireOrganiserOwner(organiserId);
  if ("error" in ctx) return { error: ctx.error };

  const { error } = await ctx.sb
    .from("event_organisers")
    .insert({ organiser_id: organiserId, event_id: eventId });
  if (error) {
    if ((error as any).code === "23505") {
      // Already linked — idempotent
      return { ok: true };
    }
    return { error: error.message };
  }
  revalidatePath(`/dashboard/organiser/${organiserId}/events`);
  return { ok: true };
}

export async function relinquishOwnership(
  organiserId: string,
  eventId: string,
): Promise<{ error: string } | { ok: true }> {
  const ctx = await requireOrganiserOwner(organiserId);
  if ("error" in ctx) return { error: ctx.error };

  const { error } = await ctx.sb
    .from("event_organisers")
    .delete()
    .eq("organiser_id", organiserId)
    .eq("event_id", eventId);
  if (error) return { error: error.message };
  revalidatePath(`/dashboard/organiser/${organiserId}/events`);
  return { ok: true };
}

export type VenueOption = { id: string; name: string; slug: string; cityName: string | null };

export type CityOption = { id: string; name: string };

// Cities a brand-new venue can be filed under when the organiser is
// creating one on the fly. Active cities only — hidden ones are
// admin-internal regions that promoters shouldn't be filing events to.
export async function listActiveCitiesForOrganiser(): Promise<CityOption[]> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];
  const sb = createServiceClient();
  const { data } = await sb
    .from("cities")
    .select("id, name")
    .eq("active", true)
    .order("name");
  return (data ?? []).map((c: any) => ({ id: c.id as string, name: c.name as string }));
}

export async function searchVenuesForOrganiser(query: string): Promise<VenueOption[]> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];

  const sb = createServiceClient();
  const q = query.trim();
  let req = sb
    .from("venues")
    .select("id, name, slug, city:cities(name)")
    .eq("approved", true)
    .order("name")
    .limit(15);
  if (q.length > 0) {
    const qStripped = q.replace(/^the\s+/i, "").trim() || q;
    req = req.ilike("name", `%${qStripped.replace(/[%_]/g, "")}%`);
  }
  const { data } = await req;
  return (data ?? []).map((v: any) => ({
    id: v.id,
    name: v.name,
    slug: v.slug,
    cityName: v.city?.name ?? null,
  }));
}

// Slugify mirroring the venue-create helper in dashboard/venues/actions.
// Inlined here so this PR doesn't depend on @/lib/utils additions that
// might land in a different order.
function slugifyVenueName(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/['']/g, "")
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 80) || "venue";
}

export async function addEventAsOrganiser(
  organiserId: string,
  fields: {
    title: string;
    // EITHER pick an existing venue:
    venue_id?: string | null;
    // OR create a brand-new one on the fly. Both name + city_id required
    // for the create path. The new venue is inserted with approved=false
    // so admin reviews it before it shows on public listings; the event
    // also lands pending, which matches the existing organiser flow.
    create_venue_name?: string | null;
    create_venue_city_id?: string | null;
    create_venue_address?: string | null;
    create_venue_postcode?: string | null;
    start_time: string; // ISO
    end_time?: string | null;
    description?: string | null;
    cover_charge?: string | null;
    ticket_url?: string | null;
  },
): Promise<{ error: string } | { ok: true; eventId: string; createdVenue?: boolean }> {
  const ctx = await requireOrganiserOwner(organiserId);
  if ("error" in ctx) return { error: ctx.error };

  if (!fields.title?.trim()) return { error: "Title required." };
  if (!fields.start_time) return { error: "Start time required." };

  // Resolve which venue this event lands at.
  let venueId: string | null = (fields.venue_id ?? "").trim() || null;
  let createdVenue = false;

  if (!venueId) {
    // Create-new path. Name + city are mandatory; address + postcode
    // optional so the promoter can leave them blank when they don't
    // know yet.
    const newName = (fields.create_venue_name ?? "").trim();
    const cityId = (fields.create_venue_city_id ?? "").trim();
    if (!newName) {
      return { error: "Pick an existing venue, or type a new venue name." };
    }
    if (!cityId) {
      return { error: "Pick a city for the new venue." };
    }

    // Slug-uniqueness with a few retries — protects against two
    // venues that happen to slugify identically (e.g. "The Hall" and
    // "the hall!" both → "the-hall").
    const baseSlug = slugifyVenueName(newName);
    let trySlug = baseSlug;
    let inserted: { id: string } | null = null;
    for (let i = 0; i < 5 && !inserted; i++) {
      const { data: ins, error: insErr } = await ctx.sb
        .from("venues")
        .insert({
          name: newName,
          slug: trySlug,
          city_id: cityId,
          address: (fields.create_venue_address ?? "").trim() || null,
          postcode: (fields.create_venue_postcode ?? "").trim() || null,
          // Admin reviews the new venue (same gating as a submit-gig
          // unlisted-venue suggestion) — approved=false hides it from
          // public listings until cleared.
          approved: false,
        })
        .select("id")
        .single();
      if (ins) {
        inserted = ins;
        break;
      }
      if (insErr?.code === "23505") {
        // Slug collision — try a numeric suffix.
        trySlug = `${baseSlug}-${i + 2}`;
        continue;
      }
      return { error: `Couldn't create venue: ${insErr?.message ?? "unknown"}` };
    }
    if (!inserted) {
      return { error: "Couldn't find a free slug for the new venue." };
    }
    venueId = inserted.id;
    createdVenue = true;
  }

  // Insert with status=pending — admin reviews organiser-created events.
  // Stays pending even when the venue is brand new (the venue itself is
  // also pending in that case, so admin sees both at once).
  const { data, error } = await ctx.sb
    .from("events")
    .insert({
      title: fields.title.trim(),
      venue_id: venueId,
      start_time: fields.start_time,
      end_time: fields.end_time ?? null,
      description: fields.description ?? null,
      cover_charge: fields.cover_charge ?? null,
      ticket_url: fields.ticket_url ?? null,
      status: "pending",
      submitted_by: ctx.user.id,
    })
    .select("id")
    .single();
  if (error) return { error: error.message };

  // Link the new event to this organiser.
  await ctx.sb
    .from("event_organisers")
    .insert({ organiser_id: organiserId, event_id: data.id });

  revalidatePath(`/dashboard/organiser/${organiserId}/events`);
  return { ok: true, eventId: data.id, createdVenue };
}
