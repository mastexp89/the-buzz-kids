"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { slugify } from "@/lib/utils";

async function resolveArtistNames(
  supabase: Awaited<ReturnType<typeof createClient>>,
  names: string[]
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
    if (!error && created) ids.push(created.id);
  }
  return ids;
}

// A <input type="datetime-local"> value ("2026-07-05T13:00") is a UK wall-clock
// time. Plain `new Date(s)` parses it in the SERVER's timezone (UTC on Vercel),
// so 1pm got stored as 1pm UTC and then displayed as 2pm BST. Convert it as
// Europe/London → correct UTC instant, DST-exact (no offset guessing).
function parseDateTimeLocal(s: string): string | null {
  if (!s) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(s);
  if (!m) {
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  const [, y, mo, d, h, mi] = m.map(Number) as unknown as number[];
  const wantUtc = Date.UTC(y, mo - 1, d, h, mi);
  let utcMs = wantUtc;
  for (let i = 0; i < 3; i++) {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/London", hour12: false,
      year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
    }).formatToParts(new Date(utcMs));
    const g = (t: string) => Number(parts.find((p) => p.type === t)!.value);
    const londonAsUtc = Date.UTC(g("year"), g("month") - 1, g("day"), g("hour") === 24 ? 0 : g("hour"), g("minute"));
    const diff = wantUtc - londonAsUtc;
    if (diff === 0) break;
    utcMs += diff;
  }
  return new Date(utcMs).toISOString();
}

// "Runs until" — a plain date (last day of a multi-day run, e.g. a two-week
// exhibition). Stored in events.end_date; What's On shows the event on every
// day of the run.
function parseRunsUntil(s: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec((s || "").trim());
  return m ? m[0] : null;
}

async function isAdmin(supabase: Awaited<ReturnType<typeof createClient>>, userId: string) {
  const { data } = await supabase.from("profiles").select("role").eq("id", userId).maybeSingle();
  return data?.role === "admin";
}

async function ownsVenue(venueId: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: venue } = await supabase
    .from("venues")
    .select("id, owner_id")
    .eq("id", venueId)
    .single();
  if (!venue) return null;
  if (venue.owner_id !== user.id && !(await isAdmin(supabase, user.id))) return null;
  return { supabase, user, venueId };
}

async function ownsEvent(eventId: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: event } = await supabase
    .from("events")
    .select("id, venue:venues!inner(id, owner_id)")
    .eq("id", eventId)
    .single();
  if (!event) return null;
  if ((event.venue as any).owner_id !== user.id && !(await isAdmin(supabase, user.id))) return null;
  return { supabase, user, eventId, venueId: (event.venue as any).id as string };
}

export async function createEvent(venueId: string, formData: FormData) {
  const ctx = await ownsVenue(venueId);
  if (!ctx) return { error: "Not authorised." };
  const { supabase } = ctx;

  const title = String(formData.get("title") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim() || null;
  const start_time = parseDateTimeLocal(String(formData.get("start_time") ?? ""));
  const end_time = parseDateTimeLocal(String(formData.get("end_time") ?? ""));
  const end_date = parseRunsUntil(String(formData.get("end_date") ?? ""));
  const cover_charge = String(formData.get("cover_charge") ?? "").trim() || null;
  const ticket_url = String(formData.get("ticket_url") ?? "").trim() || null;
  const image_url = String(formData.get("image_url") ?? "").trim() || null;
  const genreIds = formData.getAll("genres").map(String).filter(Boolean);
  const existingArtistIds = formData.getAll("artist_ids").map(String).filter(Boolean);
  const newArtistNames = formData.getAll("new_artist_names").map(String).filter(Boolean);

  if (!title || !start_time) return { error: "Title and start time are required." };

  // Venue owners' own gigs go straight live — no admin or self-approval needed.
  // Only artist-submitted gigs (via /submit-gig) are status='pending'.
  const { data: created, error } = await supabase
    .from("events")
    .insert({
      venue_id: venueId,
      title, description, start_time, end_time, end_date, cover_charge, ticket_url, image_url,
      status: "approved",
    })
    .select("id")
    .single();
  if (error) return { error: error.message };

  if (genreIds.length) {
    const rows = genreIds.map((gid) => ({ event_id: created.id, genre_id: gid }));
    const { error: gErr } = await supabase.from("event_genres").insert(rows);
    if (gErr) return { error: gErr.message };
  }

  const newArtistIds = newArtistNames.length > 0 ? await resolveArtistNames(supabase, newArtistNames) : [];
  const allArtistIds = Array.from(new Set([...existingArtistIds, ...newArtistIds]));
  if (allArtistIds.length) {
    await supabase.from("event_artists").insert(
      allArtistIds.map((aid) => ({ event_id: created.id, artist_id: aid }))
    );
  }

  // Optional: also create weekly copies of this gig in one go. Lets a
  // venue setting up a weekly residency / quiz night / open mic enter it
  // once. Validated 1..52; anything else is silently dropped (so a typo
  // doesn't 500 the form).
  const repeatRaw = String(formData.get("repeat_weeks") ?? "").trim();
  const repeatWeeks = repeatRaw ? Number(repeatRaw) : 0;
  if (Number.isInteger(repeatWeeks) && repeatWeeks >= 1 && repeatWeeks <= 52) {
    await createWeeklyCopies(supabase, created.id, repeatWeeks);
  }

  revalidatePath(`/dashboard/venues/${venueId}`);
  redirect(`/dashboard/venues/${venueId}`);
}

export async function updateEvent(eventId: string, formData: FormData) {
  const ctx = await ownsEvent(eventId);
  if (!ctx) return { error: "Not authorised." };
  const { supabase, venueId } = ctx;

  const title = String(formData.get("title") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim() || null;
  const start_time = parseDateTimeLocal(String(formData.get("start_time") ?? ""));
  const end_time = parseDateTimeLocal(String(formData.get("end_time") ?? ""));
  const cover_charge = String(formData.get("cover_charge") ?? "").trim() || null;
  const ticket_url = String(formData.get("ticket_url") ?? "").trim() || null;
  const image_url = String(formData.get("image_url") ?? "").trim() || null;
  const end_date = parseRunsUntil(String(formData.get("end_date") ?? ""));
  const cancelled = formData.get("cancelled") === "on";
  const genreIds = formData.getAll("genres").map(String).filter(Boolean);
  const existingArtistIds = formData.getAll("artist_ids").map(String).filter(Boolean);
  const newArtistNames = formData.getAll("new_artist_names").map(String).filter(Boolean);

  if (!title || !start_time) return { error: "Title and start time are required." };

  const { error } = await supabase
    .from("events")
    .update({ title, description, start_time, end_time, end_date, cover_charge, ticket_url, image_url, cancelled })
    .eq("id", eventId);
  if (error) return { error: error.message };

  await supabase.from("event_genres").delete().eq("event_id", eventId);
  if (genreIds.length) {
    const rows = genreIds.map((gid) => ({ event_id: eventId, genre_id: gid }));
    const { error: gErr } = await supabase.from("event_genres").insert(rows);
    if (gErr) return { error: gErr.message };
  }

  await supabase.from("event_artists").delete().eq("event_id", eventId);
  const newArtistIds = newArtistNames.length > 0 ? await resolveArtistNames(supabase, newArtistNames) : [];
  const allArtistIds = Array.from(new Set([...existingArtistIds, ...newArtistIds]));
  if (allArtistIds.length) {
    await supabase.from("event_artists").insert(
      allArtistIds.map((aid) => ({ event_id: eventId, artist_id: aid }))
    );
  }

  revalidatePath(`/dashboard/venues/${venueId}`);
  return { ok: true };
}

export async function deleteEvent(eventId: string) {
  const ctx = await ownsEvent(eventId);
  if (!ctx) return { error: "Not authorised." };
  const { supabase, venueId } = ctx;

  const { error } = await supabase.from("events").delete().eq("id", eventId);
  if (error) return { error: error.message };

  revalidatePath(`/dashboard/venues/${venueId}`);
  redirect(`/dashboard/venues/${venueId}`);
}

export async function duplicateEvent(eventId: string, targetDate?: string) {
  const ctx = await ownsEvent(eventId);
  if (!ctx) return { error: "Not authorised." };
  const { supabase, venueId } = ctx;

  const { data: src } = await supabase.from("events").select("*").eq("id", eventId).single();
  if (!src) return { error: "Event not found." };

  // Shift by whole days: default +7 (next week), or to a chosen date — the
  // wall-clock time stays the same, only the day moves. Day delta is computed
  // on London calendar days so DST can't skew it.
  let deltaDays = 7;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec((targetDate || "").trim());
  if (m) {
    const srcDay = new Date(src.start_time).toLocaleDateString("en-CA", { timeZone: "Europe/London" });
    const [sy, sm, sd] = srcDay.split("-").map(Number);
    deltaDays = Math.round((Date.UTC(+m[1], +m[2] - 1, +m[3]) - Date.UTC(sy, sm - 1, sd)) / 86_400_000);
    if (deltaDays === 0) return { error: "Pick a different date — that's the same day as the original." };
  }
  const shift = (iso: string) => {
    const d = new Date(iso);
    d.setUTCDate(d.getUTCDate() + deltaDays);
    return d.toISOString();
  };
  const shiftDate = (day: string) => {
    const [y, mo, dd] = day.split("-").map(Number);
    const d = new Date(Date.UTC(y, mo - 1, dd + deltaDays));
    return d.toISOString().slice(0, 10);
  };

  const { data: created, error } = await supabase
    .from("events")
    .insert({
      venue_id: src.venue_id,
      title: src.title,
      description: src.description,
      start_time: shift(src.start_time),
      end_time: src.end_time ? shift(src.end_time) : null,
      end_date: src.end_date ? shiftDate(src.end_date) : null,
      cover_charge: src.cover_charge,
      ticket_url: src.ticket_url,
      image_url: src.image_url,
      age_min: src.age_min,
      age_max: src.age_max,
      is_free: src.is_free,
      setting: src.setting,
      accessibility: src.accessibility,
      status: src.status,
    })
    .select("id")
    .single();
  if (error) return { error: error.message };

  const { data: srcGenres } = await supabase.from("event_genres").select("genre_id").eq("event_id", eventId);
  if (srcGenres && srcGenres.length > 0) {
    await supabase.from("event_genres").insert(
      srcGenres.map((g: any) => ({ event_id: created.id, genre_id: g.genre_id }))
    );
  }
  const { data: srcArtists } = await supabase.from("event_artists").select("artist_id").eq("event_id", eventId);
  if (srcArtists && srcArtists.length > 0) {
    await supabase.from("event_artists").insert(
      srcArtists.map((a: any) => ({ event_id: created.id, artist_id: a.artist_id }))
    );
  }

  revalidatePath(`/dashboard/venues/${venueId}`);
  redirect(`/dashboard/venues/${venueId}/events/${created.id}/edit`);
}

// Internal helper: clone a source event +1, +2, ... +N weeks. Skips the
// auth check (callers must do their own). Returns the count actually
// inserted so callers can surface "Created N gigs" toasts.
async function createWeeklyCopies(
  supabase: Awaited<ReturnType<typeof createClient>>,
  srcEventId: string,
  weeks: number,
): Promise<{ created: number } | { error: string }> {
  if (!Number.isInteger(weeks) || weeks < 1 || weeks > 52) {
    return { error: "Pick between 1 and 52 weeks." };
  }

  const { data: src } = await supabase.from("events").select("*").eq("id", srcEventId).single();
  if (!src) return { error: "Event not found." };

  const { data: srcGenres } = await supabase.from("event_genres").select("genre_id").eq("event_id", srcEventId);
  const genreIds: string[] = (srcGenres ?? []).map((g: any) => g.genre_id);
  const { data: srcArtists } = await supabase.from("event_artists").select("artist_id").eq("event_id", srcEventId);
  const artistIds: string[] = (srcArtists ?? []).map((a: any) => a.artist_id);

  let created = 0;
  for (let w = 1; w <= weeks; w++) {
    const start = new Date(src.start_time);
    start.setDate(start.getDate() + 7 * w);
    let end: Date | null = null;
    if (src.end_time) {
      end = new Date(src.end_time);
      end.setDate(end.getDate() + 7 * w);
    }
    const { data: row, error } = await supabase
      .from("events")
      .insert({
        venue_id: src.venue_id,
        title: src.title,
        description: src.description,
        start_time: start.toISOString(),
        end_time: end?.toISOString() ?? null,
        cover_charge: src.cover_charge,
        ticket_url: src.ticket_url,
        image_url: src.image_url,
        status: src.status,
      })
      .select("id")
      .single();
    if (error) return { error: error.message };

    if (genreIds.length > 0) {
      await supabase.from("event_genres").insert(genreIds.map((gid) => ({ event_id: row.id, genre_id: gid })));
    }
    if (artistIds.length > 0) {
      await supabase.from("event_artists").insert(artistIds.map((aid) => ({ event_id: row.id, artist_id: aid })));
    }
    created++;
  }

  return { created };
}

export type RepeatEventResult =
  | { error: string }
  | { ok: true; created: number };

export async function repeatEvent(
  eventId: string,
  weeks: number,
): Promise<RepeatEventResult> {
  const ctx = await ownsEvent(eventId);
  if (!ctx) return { error: "Not authorised." };
  const { supabase, venueId } = ctx;

  const res = await createWeeklyCopies(supabase, eventId, weeks);
  if ("error" in res) return res;

  revalidatePath(`/dashboard/venues/${venueId}`);
  return { ok: true, created: res.created };
}
