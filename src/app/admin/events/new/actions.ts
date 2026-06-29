"use server";

import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { revalidatePath } from "next/cache";

export type CreateEventResult =
  | { ok: true; citySlug: string; eventId: string }
  | { error: string };

// Build a UK-local ISO timestamp from a date + optional time. Approximates
// British Summer Time (BST, +01:00) for Apr–Oct, GMT otherwise — good enough
// for display; admins can fine-tune on the event afterwards.
function toIso(date: string, time: string): string | null {
  if (!date) return null;
  const t = /^\d{2}:\d{2}$/.test(time) ? time : "10:00";
  const month = parseInt(date.slice(5, 7), 10);
  const offset = month >= 4 && month <= 10 ? "+01:00" : "+00:00";
  return `${date}T${t}:00${offset}`;
}

async function requireAdmin() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: prof } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  return prof?.role === "admin" ? user : null;
}

export async function createEvent(formData: FormData): Promise<CreateEventResult> {
  const admin = await requireAdmin();
  if (!admin) return { error: "Admins only." };

  const title = String(formData.get("title") ?? "").trim();
  if (!title) return { error: "Give the event a title." };

  const startDate = String(formData.get("start_date") ?? "").trim();
  const startIso = toIso(startDate, String(formData.get("start_time") ?? ""));
  if (!startIso) return { error: "Pick a start date." };

  const endDate = String(formData.get("end_date") ?? "").trim();
  const endIso = endDate ? toIso(endDate, String(formData.get("end_time") ?? "")) : null;

  const venueId = String(formData.get("venue_id") ?? "").trim() || null;
  const locationName = String(formData.get("location_name") ?? "").trim() || null;
  let cityId = String(formData.get("city_id") ?? "").trim() || null;

  const sb = createServiceClient();

  // Attached to a place → derive its city, no standalone location needed.
  // Standalone → require a location name + an area.
  if (venueId) {
    const { data: v } = await sb.from("venues").select("city_id").eq("id", venueId).maybeSingle();
    if (!v) return { error: "That place wasn't found." };
    cityId = null; // display uses the venue's own city
  } else {
    if (!locationName) return { error: "Add a location (or attach a place)." };
    if (!cityId) return { error: "Pick which area this event is in." };
  }

  const isFree = formData.get("is_free") === "on";
  const coverCharge = String(formData.get("cover_charge") ?? "").trim() || null;
  const description = String(formData.get("description") ?? "").trim() || null;
  const ticketUrl = String(formData.get("ticket_url") ?? "").trim() || null;

  const { data: event, error } = await sb
    .from("events")
    .insert({
      venue_id: venueId,
      city_id: cityId,
      location_name: venueId ? null : locationName,
      title,
      description,
      start_time: startIso,
      end_time: endIso,
      is_free: isFree,
      cover_charge: isFree ? null : coverCharge,
      ticket_url: ticketUrl,
      status: "approved",
    })
    .select("id, venue:venues(city:cities(slug)), city:cities(slug)")
    .single();
  if (error) return { error: error.message };

  const citySlug =
    (event.venue as any)?.city?.slug ?? (event as any).city?.slug ?? "dundee";

  revalidatePath("/browse");
  revalidatePath("/admin/events");
  return { ok: true, citySlug, eventId: event.id };
}
