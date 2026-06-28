"use server";

// Server actions for the fan favourites system.
//
// All actions are scoped to the signed-in user via the RLS policies on
// the favourites table — we don't need to filter by user_id manually
// because auth.uid() does it for us.

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export type FavouriteTarget = "venue" | "artist" | "organiser" | "event";

export type ToggleFavouriteResult =
  | { ok: true; favourited: boolean }
  | { error: string; needsSignIn?: boolean };

/**
 * Toggle a favourite. If the row exists for (user, target_type, target_id)
 * it's removed; otherwise it's inserted. Returns the new favourited state
 * so the client can render the heart filled / unfilled without re-fetching.
 */
export async function toggleFavourite(
  targetType: FavouriteTarget,
  targetId: string,
): Promise<ToggleFavouriteResult> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Sign in to save favourites.", needsSignIn: true };

  // Check current state
  const { data: existing } = await supabase
    .from("favourites")
    .select("id")
    .eq("user_id", user.id)
    .eq("target_type", targetType)
    .eq("target_id", targetId)
    .maybeSingle();

  if (existing) {
    const { error } = await supabase
      .from("favourites")
      .delete()
      .eq("id", existing.id);
    if (error) return { error: error.message };
    revalidatePath("/dashboard/favourites");
    return { ok: true, favourited: false };
  }

  const { error } = await supabase
    .from("favourites")
    .insert({ user_id: user.id, target_type: targetType, target_id: targetId });
  // Unique constraint violation = already favourited by a race — treat as success
  if (error && (error as any).code !== "23505") {
    return { error: error.message };
  }
  revalidatePath("/dashboard/favourites");
  return { ok: true, favourited: true };
}

export type MyFavouritesResult = {
  venueIds: string[];
  artistIds: string[];
  organiserIds: string[];
  eventIds: string[];
};

/**
 * Get all favourite ids for the signed-in user, grouped by target type.
 * Used by the dashboard favourites page and the per-card pre-fill so the
 * heart starts in the right state without a per-render lookup.
 */
export async function getMyFavourites(): Promise<MyFavouritesResult> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { venueIds: [], artistIds: [], organiserIds: [], eventIds: [] };

  const { data: rows } = await supabase
    .from("favourites")
    .select("target_type, target_id")
    .eq("user_id", user.id);

  const result: MyFavouritesResult = {
    venueIds: [],
    artistIds: [],
    organiserIds: [],
    eventIds: [],
  };
  for (const r of rows ?? []) {
    if (r.target_type === "venue") result.venueIds.push(r.target_id as string);
    else if (r.target_type === "artist") result.artistIds.push(r.target_id as string);
    else if (r.target_type === "organiser") result.organiserIds.push(r.target_id as string);
    else if (r.target_type === "event") result.eventIds.push(r.target_id as string);
  }
  return result;
}

/**
 * Quick "is this thing favourited by the current user?" check. Returns
 * false for anon. Used by detail pages to seed the heart button's
 * initial state.
 */
export async function isFavourited(
  targetType: FavouriteTarget,
  targetId: string,
): Promise<boolean> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return false;
  const { data } = await supabase
    .from("favourites")
    .select("id")
    .eq("user_id", user.id)
    .eq("target_type", targetType)
    .eq("target_id", targetId)
    .maybeSingle();
  return !!data;
}

export type PlannerEvent = {
  id: string;
  title: string;
  start_time: string;
  end_time: string | null;
  image_url: string | null;
  venue: {
    id: string;
    name: string;
    slug: string;
    address: string | null;
    latitude: number | null;
    longitude: number | null;
    citySlug: string | null;
  };
};

/**
 * Resolve the signed-in user's favourited events that fall within the
 * given time window. Pulls from all four favourite sources (direct
 * event, venue, artist, organiser) and deduplicates so each event
 * shows up once even if multiple favourites apply. Results are ordered
 * chronologically.
 *
 * Used by /dashboard/today (the day-planner page). Empty array when
 * the user has no favourites in the window.
 */
export async function getMyFavouriteEventsInWindow(
  startIso: string,
  endIso: string,
): Promise<PlannerEvent[]> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];

  // Step 1: get all the user's favourites (cheap — small per user)
  const { data: favs } = await supabase
    .from("favourites")
    .select("target_type, target_id")
    .eq("user_id", user.id);
  if (!favs || favs.length === 0) return [];

  const venueIds: string[] = [];
  const artistIds: string[] = [];
  const organiserIds: string[] = [];
  const directEventIds: string[] = [];
  for (const f of favs) {
    if (f.target_type === "venue") venueIds.push(f.target_id as string);
    else if (f.target_type === "artist") artistIds.push(f.target_id as string);
    else if (f.target_type === "organiser") organiserIds.push(f.target_id as string);
    else if (f.target_type === "event") directEventIds.push(f.target_id as string);
  }

  // Step 2: collect event ids from each source via junction tables.
  // RLS on events already filters out unpublished-festival events for
  // the public, but a logged-in user who's NOT admin reads through the
  // same policy — so this is automatic. We don't need to re-filter here.
  const eventIdsToFetch = new Set<string>(directEventIds);

  if (artistIds.length > 0) {
    const { data: rows } = await supabase
      .from("event_artists")
      .select("event_id")
      .in("artist_id", artistIds);
    for (const r of rows ?? []) eventIdsToFetch.add(r.event_id as string);
  }
  if (organiserIds.length > 0) {
    const { data: rows } = await supabase
      .from("event_organisers")
      .select("event_id")
      .in("organiser_id", organiserIds);
    for (const r of rows ?? []) eventIdsToFetch.add(r.event_id as string);
  }

  // Step 3: fetch the events. Venue follows resolved here too (no
  // junction needed — events have venue_id directly).
  const filters: any[] = [];
  const idArr = Array.from(eventIdsToFetch);
  if (idArr.length === 0 && venueIds.length === 0) return [];

  // Build an OR clause: id IN (...) OR venue_id IN (...)
  // PostgREST .or() syntax: "id.in.(a,b,c),venue_id.in.(x,y)"
  const orParts: string[] = [];
  if (idArr.length > 0) orParts.push(`id.in.(${idArr.join(",")})`);
  if (venueIds.length > 0) orParts.push(`venue_id.in.(${venueIds.join(",")})`);

  let query = supabase
    .from("events")
    .select(
      "id, title, start_time, end_time, image_url, venue:venues(id, name, slug, address, latitude, longitude, city:cities(slug))",
    )
    .gte("start_time", startIso)
    .lte("start_time", endIso)
    .eq("status", "approved")
    .eq("cancelled", false)
    .order("start_time", { ascending: true });

  if (orParts.length === 1) {
    // .or() with a single clause still works
    query = query.or(orParts[0]);
  } else {
    query = query.or(orParts.join(","));
  }

  const { data: events } = await query;

  // Dedup defensively (a single event might match multiple sources)
  const seen = new Set<string>();
  const out: PlannerEvent[] = [];
  for (const e of events ?? []) {
    if (seen.has(e.id as string)) continue;
    seen.add(e.id as string);
    const v = (e.venue ?? {}) as any;
    out.push({
      id: e.id as string,
      title: e.title as string,
      start_time: e.start_time as string,
      end_time: (e.end_time ?? null) as string | null,
      image_url: (e.image_url ?? null) as string | null,
      venue: {
        id: v?.id ?? "",
        name: v?.name ?? "",
        slug: v?.slug ?? "",
        address: v?.address ?? null,
        latitude: typeof v?.latitude === "number" ? v.latitude : null,
        longitude: typeof v?.longitude === "number" ? v.longitude : null,
        citySlug: v?.city?.slug ?? null,
      },
    });
  }
  return out;
}
