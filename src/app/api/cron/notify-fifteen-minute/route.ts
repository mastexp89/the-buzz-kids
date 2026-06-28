// Cron: "starts in 15 minutes" reminder. Runs every 5 minutes and
// looks for events starting in a 13–17-minute window from now. Anyone
// who's favourited the event itself or who follows one of the linked
// venue / artists / organisers gets a single email with a Maps link.
//
// The 4-minute window (13–17) gives the every-5-min cron some slack
// so it doesn't matter exactly when a run lands inside its slot.
//
// Idempotency: a notifications_sent row of type "fifteen_minute" per
// (user, event) prevents a second reminder if the cron retries.

import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { notifyFifteenMinutes } from "@/lib/email";

export const maxDuration = 60;

const NOTIFICATION_TYPE = "fifteen_minute";

export async function GET(req: Request) {
  const auth = req.headers.get("authorization");
  const expected = `Bearer ${process.env.CRON_SECRET ?? ""}`;
  if (!process.env.CRON_SECRET || auth !== expected) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }

  const url = new URL(req.url);
  const dry = url.searchParams.get("dry") === "1";

  const sb = createServiceClient();
  const now = Date.now();
  const lowerIso = new Date(now + 13 * 60 * 1000).toISOString();
  const upperIso = new Date(now + 17 * 60 * 1000).toISOString();

  // Step 1: find events kicking off in the window
  const { data: rawEvents } = await sb
    .from("events")
    .select(
      "id, title, start_time, venue_id, festival_id, status, cancelled, venue:venues(name, address, city:cities(slug))",
    )
    .gte("start_time", lowerIso)
    .lte("start_time", upperIso)
    .eq("status", "approved")
    .eq("cancelled", false);

  // Filter unpublished-festival events
  const festivalIds = Array.from(
    new Set(
      (rawEvents ?? [])
        .filter((e: any) => e.festival_id)
        .map((e: any) => e.festival_id),
    ),
  );
  let publishedFestivalSet = new Set<string>();
  if (festivalIds.length > 0) {
    const { data: publishedFestivals } = await sb
      .from("festivals")
      .select("id")
      .in("id", festivalIds)
      .eq("published", true);
    publishedFestivalSet = new Set((publishedFestivals ?? []).map((f: any) => f.id));
  }
  const events = (rawEvents ?? []).filter(
    (e: any) => !e.festival_id || publishedFestivalSet.has(e.festival_id),
  );
  if (events.length === 0) {
    return NextResponse.json({ ok: true, sent: 0, message: "No events in window." });
  }

  // Step 2: collect every user who should get a reminder for each event.
  // Sources: direct event favourite, venue favourite, artist favourite,
  // organiser favourite. Deduplicate at (user, event) granularity.
  const eventIds = events.map((e: any) => e.id);
  const venueIds = Array.from(new Set(events.map((e: any) => e.venue_id).filter(Boolean)));

  // For artist/organiser pulls we first need the junction rows.
  const [{ data: artistRows }, { data: organiserRows }] = await Promise.all([
    sb.from("event_artists").select("event_id, artist_id").in("event_id", eventIds),
    sb.from("event_organisers").select("event_id, organiser_id").in("event_id", eventIds),
  ]);
  const allArtistIds = Array.from(
    new Set((artistRows ?? []).map((r: any) => r.artist_id)),
  );
  const allOrganiserIds = Array.from(
    new Set((organiserRows ?? []).map((r: any) => r.organiser_id)),
  );

  // Now pull all matching favourites in one batch each
  const [{ data: eventFavs }, { data: venueFavs }, { data: artistFavs }, { data: orgFavs }] =
    await Promise.all([
      sb
        .from("favourites")
        .select("user_id, target_id")
        .eq("target_type", "event")
        .in("target_id", eventIds),
      venueIds.length > 0
        ? sb
            .from("favourites")
            .select("user_id, target_id")
            .eq("target_type", "venue")
            .in("target_id", venueIds)
        : Promise.resolve({ data: [] as any[] }),
      allArtistIds.length > 0
        ? sb
            .from("favourites")
            .select("user_id, target_id")
            .eq("target_type", "artist")
            .in("target_id", allArtistIds)
        : Promise.resolve({ data: [] as any[] }),
      allOrganiserIds.length > 0
        ? sb
            .from("favourites")
            .select("user_id, target_id")
            .eq("target_type", "organiser")
            .in("target_id", allOrganiserIds)
        : Promise.resolve({ data: [] as any[] }),
    ]);

  // Build (user, event) reminder set
  const reminderSet = new Set<string>(); // "user_id|event_id"
  function addRem(userId: string, eventId: string) {
    reminderSet.add(`${userId}|${eventId}`);
  }
  for (const f of eventFavs ?? []) addRem((f as any).user_id, (f as any).target_id);
  for (const f of venueFavs ?? []) {
    const matchingEvents = events.filter((e: any) => e.venue_id === (f as any).target_id);
    for (const e of matchingEvents) addRem((f as any).user_id, e.id);
  }
  for (const f of artistFavs ?? []) {
    const matchingEventIds = (artistRows ?? [])
      .filter((r: any) => r.artist_id === (f as any).target_id)
      .map((r: any) => r.event_id);
    for (const eid of matchingEventIds) addRem((f as any).user_id, eid);
  }
  for (const f of orgFavs ?? []) {
    const matchingEventIds = (organiserRows ?? [])
      .filter((r: any) => r.organiser_id === (f as any).target_id)
      .map((r: any) => r.event_id);
    for (const eid of matchingEventIds) addRem((f as any).user_id, eid);
  }

  if (reminderSet.size === 0) {
    return NextResponse.json({
      ok: true,
      sent: 0,
      eventsConsidered: events.length,
      message: "No followers matched.",
    });
  }

  // Step 3: profiles, prefs, dedup
  const reminders = Array.from(reminderSet).map((k) => {
    const [user_id, event_id] = k.split("|");
    return { user_id, event_id };
  });
  const userIds = Array.from(new Set(reminders.map((r) => r.user_id)));

  const [{ data: profiles }, { data: alreadySent }] = await Promise.all([
    sb
      .from("profiles")
      .select("id, email, notification_prefs")
      .in("id", userIds),
    sb
      .from("notifications_sent")
      .select("user_id, event_id")
      .eq("notification_type", NOTIFICATION_TYPE)
      .in("user_id", userIds)
      .in("event_id", eventIds),
  ]);
  const profileById = new Map<string, any>();
  for (const p of profiles ?? []) profileById.set((p as any).id, p);
  const alreadySentSet = new Set<string>(
    (alreadySent ?? []).map((r: any) => `${r.user_id}|${r.event_id}`),
  );
  const eventById = new Map<string, any>();
  for (const e of events) eventById.set((e as any).id, e);

  let sent = 0;
  let skipped = 0;
  const sendErrors: string[] = [];

  for (const r of reminders) {
    const profile = profileById.get(r.user_id);
    if (!profile?.email) {
      skipped += 1;
      continue;
    }
    const prefs = profile.notification_prefs ?? {};
    if (prefs.fifteen_minute_reminder === false) {
      skipped += 1;
      continue;
    }
    if (alreadySentSet.has(`${r.user_id}|${r.event_id}`)) {
      skipped += 1;
      continue;
    }
    const event = eventById.get(r.event_id);
    if (!event) continue;
    if (dry) {
      sent += 1;
      continue;
    }
    const ok = await notifyFifteenMinutes({
      userEmail: profile.email,
      title: event.title,
      venueName: event.venue?.name ?? "—",
      venueAddress: event.venue?.address ?? null,
      citySlug: event.venue?.city?.slug ?? "dundee",
      eventId: event.id,
    });
    if (!ok) {
      sendErrors.push(profile.email);
      continue;
    }
    sent += 1;
    await sb.from("notifications_sent").insert({
      user_id: r.user_id,
      notification_type: NOTIFICATION_TYPE,
      event_id: r.event_id,
    });
  }

  return NextResponse.json({
    ok: true,
    sent,
    skipped,
    eventsConsidered: events.length,
    remindersConsidered: reminders.length,
    sendErrors: sendErrors.length > 0 ? sendErrors : undefined,
    dry,
  });
}
