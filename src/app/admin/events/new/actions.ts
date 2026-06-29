"use server";

import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { revalidatePath } from "next/cache";

export type CreateEventResult =
  | { ok: true; citySlug: string; eventId: string }
  | { error: string };

// Convert a UK-local (Europe/London) wall-clock date + time into a correct
// UTC ISO timestamp, handling BST/GMT exactly (no DST guesswork). The admin
// types "10:30" meaning 10:30 in the UK; we store the real instant so the
// Europe/London formatters display "10:30" back, summer or winter.
function toIso(date: string, time: string): string | null {
  if (!date) return null;
  const t = /^\d{2}:\d{2}$/.test(time) ? time : "10:00";
  const [y, mo, d] = date.split("-").map(Number);
  const [h, mi] = t.split(":").map(Number);
  const wantUtc = Date.UTC(y, mo - 1, d, h, mi);
  let utcMs = wantUtc;
  // Find the instant whose Europe/London wall-clock equals what was typed.
  for (let i = 0; i < 3; i++) {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/London", hour12: false,
      year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
    }).formatToParts(new Date(utcMs));
    const g = (type: string) => Number(parts.find((p) => p.type === type)!.value);
    const londonAsUtc = Date.UTC(g("year"), g("month") - 1, g("day"), g("hour") === 24 ? 0 : g("hour"), g("minute"));
    const diff = wantUtc - londonAsUtc;
    if (diff === 0) break;
    utcMs += diff;
  }
  return new Date(utcMs).toISOString();
}

async function requireAdmin() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: prof } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  // Editors (restricted contributors) can add events too — auto-approved.
  return prof?.role === "admin" || prof?.role === "editor" ? user : null;
}

export async function createEvent(formData: FormData): Promise<CreateEventResult> {
  const admin = await requireAdmin();
  if (!admin) return { error: "Staff only." };

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
