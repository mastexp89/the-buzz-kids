"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

const DEFAULT_DAYS = 7;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

type EventPromoKind = "featured" | "highlighted" | "genre_takeover" | "weekend_boost";

const COLUMN_BY_KIND: Record<EventPromoKind, string> = {
  featured: "featured_until",
  highlighted: "highlighted_until",
  genre_takeover: "genre_takeover_until",
  weekend_boost: "weekend_boost_until",
};

async function ownsEvent(eventId: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: row } = await supabase
    .from("events")
    .select("id, venue:venues!inner(id, owner_id)")
    .eq("id", eventId)
    .single();
  if (!row || (row.venue as any).owner_id !== user.id) return null;
  return { supabase, eventId, venueId: (row.venue as any).id as string };
}

async function ownsVenue(venueId: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: row } = await supabase
    .from("venues").select("id, owner_id").eq("id", venueId).single();
  if (!row || row.owner_id !== user.id) return null;
  return { supabase, venueId };
}

export async function activateEventPromo(
  eventId: string,
  kind: EventPromoKind,
  days: number = DEFAULT_DAYS
) {
  const ctx = await ownsEvent(eventId);
  if (!ctx) return { error: "Not authorised." };
  const until = new Date(Date.now() + days * MS_PER_DAY).toISOString();
  const col = COLUMN_BY_KIND[kind];
  const { error } = await ctx.supabase.from("events").update({ [col]: until }).eq("id", eventId);
  if (error) return { error: error.message };
  revalidatePath(`/dashboard/venues/${ctx.venueId}/promote`);
  revalidatePath("/dundee");
  return { ok: true };
}

export async function cancelEventPromo(eventId: string, kind: EventPromoKind) {
  const ctx = await ownsEvent(eventId);
  if (!ctx) return { error: "Not authorised." };
  const col = COLUMN_BY_KIND[kind];
  const { error } = await ctx.supabase.from("events").update({ [col]: null }).eq("id", eventId);
  if (error) return { error: error.message };
  revalidatePath(`/dashboard/venues/${ctx.venueId}/promote`);
  revalidatePath("/dundee");
  return { ok: true };
}

export async function activateVenueSpotlight(venueId: string, days: number = DEFAULT_DAYS) {
  const ctx = await ownsVenue(venueId);
  if (!ctx) return { error: "Not authorised." };
  const until = new Date(Date.now() + days * MS_PER_DAY).toISOString();
  const { error } = await ctx.supabase.from("venues").update({ spotlight_until: until }).eq("id", venueId);
  if (error) return { error: error.message };
  revalidatePath(`/dashboard/venues/${venueId}/promote`);
  revalidatePath("/");
  return { ok: true };
}

export async function cancelVenueSpotlight(venueId: string) {
  const ctx = await ownsVenue(venueId);
  if (!ctx) return { error: "Not authorised." };
  const { error } = await ctx.supabase.from("venues").update({ spotlight_until: null }).eq("id", venueId);
  if (error) return { error: error.message };
  revalidatePath(`/dashboard/venues/${venueId}/promote`);
  revalidatePath("/");
  return { ok: true };
}
