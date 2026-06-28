"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export type EventPromoKind =
  | "featured"
  | "highlighted"
  | "genre_takeover"
  | "weekend_boost";

const EVENT_COL: Record<EventPromoKind, string> = {
  featured: "featured_until",
  highlighted: "highlighted_until",
  genre_takeover: "genre_takeover_until",
  weekend_boost: "weekend_boost_until",
};

async function requireAdmin() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { supabase, ok: false as const };
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();
  return { supabase, ok: profile?.role === "admin" };
}

function isoDaysFromNow(days: number) {
  const safe = Number.isFinite(days) && days > 0 ? Math.min(days, 365) : 7;
  return new Date(Date.now() + safe * MS_PER_DAY).toISOString();
}

// ---------- Event promos ----------

export async function adminGrantEventPromo(
  eventId: string,
  kind: EventPromoKind,
  days: number = 7,
) {
  const { supabase, ok } = await requireAdmin();
  if (!ok) return { error: "Not authorised." };
  const col = EVENT_COL[kind];
  if (!col) return { error: "Unknown promotion kind." };
  const { error } = await supabase
    .from("events")
    .update({ [col]: isoDaysFromNow(days) })
    .eq("id", eventId);
  if (error) return { error: error.message };
  revalidatePath("/admin/promotions");
  revalidatePath("/dundee");
  revalidatePath("/");
  return { ok: true };
}

export async function adminCancelEventPromo(
  eventId: string,
  kind: EventPromoKind,
) {
  const { supabase, ok } = await requireAdmin();
  if (!ok) return { error: "Not authorised." };
  const col = EVENT_COL[kind];
  if (!col) return { error: "Unknown promotion kind." };
  const { error } = await supabase
    .from("events")
    .update({ [col]: null })
    .eq("id", eventId);
  if (error) return { error: error.message };
  revalidatePath("/admin/promotions");
  revalidatePath("/dundee");
  revalidatePath("/");
  return { ok: true };
}

// ---------- Venue spotlight ----------

export async function adminGrantVenueSpotlight(
  venueId: string,
  days: number = 7,
) {
  const { supabase, ok } = await requireAdmin();
  if (!ok) return { error: "Not authorised." };
  const { error } = await supabase
    .from("venues")
    .update({ spotlight_until: isoDaysFromNow(days) })
    .eq("id", venueId);
  if (error) return { error: error.message };
  revalidatePath("/admin/promotions");
  revalidatePath("/");
  return { ok: true };
}

export async function adminCancelVenueSpotlight(venueId: string) {
  const { supabase, ok } = await requireAdmin();
  if (!ok) return { error: "Not authorised." };
  const { error } = await supabase
    .from("venues")
    .update({ spotlight_until: null })
    .eq("id", venueId);
  if (error) return { error: error.message };
  revalidatePath("/admin/promotions");
  revalidatePath("/");
  return { ok: true };
}
