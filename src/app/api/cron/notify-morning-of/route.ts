// Cron: "your saved gigs today" — fires once a day in the morning with
// every favourite that's happening on the same calendar day in Europe/
// London. Source of the items:
//   * directly favourited events whose start_time is today
//   * events at favourited venues happening today
//   * events featuring favourited artists happening today
//   * events run by favourited organisers happening today
//
// Idempotency: marks (user, "morning_of", event) in notifications_sent
// so a same-day retry doesn't double-mail. Each event only mentioned
// once per user even when multiple of their favourites apply.

import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { notifyMorningOf } from "@/lib/email";
import { sendPushToUser } from "@/lib/push";

export const maxDuration = 60;

const NOTIFICATION_TYPE = "morning_of";

export async function GET(req: Request) {
  const auth = req.headers.get("authorization");
  const expected = `Bearer ${process.env.CRON_SECRET ?? ""}`;
  if (!process.env.CRON_SECRET || auth !== expected) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }

  const url = new URL(req.url);
  const dry = url.searchParams.get("dry") === "1";

  const sb = createServiceClient();

  // Today's UK calendar window. UK = UTC in winter, UTC+1 in summer.
  // Using Europe/London via toLocaleString handles this for us.
  const now = new Date();
  const todayStr = now.toLocaleDateString("en-CA", { timeZone: "Europe/London" });
  const todayStartUK = new Date(`${todayStr}T00:00:00+00:00`);
  const todayEndUK = new Date(todayStartUK.getTime() + 24 * 60 * 60 * 1000);

  // Step 1: pull every favourite row — we'll resolve each user's
  // today-relevant events from this.
  const { data: allFavourites } = await sb
    .from("favourites")
    .select("user_id, target_type, target_id");
  if (!allFavourites || allFavourites.length === 0) {
    return NextResponse.json({ ok: true, sent: 0, message: "No favourites at all." });
  }

  // Step 2: get today's events in one shot. Filter on RLS-equivalent
  // visibility (approved, not in unpublished festival).
  const { data: rawEvents } = await sb
    .from("events")
    .select(
      "id, title, start_time, venue_id, festival_id, status, venue:venues(name, city:cities(slug))",
    )
    .gte("start_time", todayStartUK.toISOString())
    .lt("start_time", todayEndUK.toISOString())
    .eq("status", "approved")
    .eq("cancelled", false);
  if (!rawEvents || rawEvents.length === 0) {
    return NextResponse.json({ ok: true, sent: 0, message: "No events today." });
  }

  // Filter out festival-hidden events
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
    return NextResponse.json({ ok: true, sent: 0, message: "No public events today." });
  }

  // Step 3: artists + organisers attached to today's events
  const eventIds = events.map((e: any) => e.id);
  const [{ data: eventArtistRows }, { data: eventOrganiserRows }] = await Promise.all([
    sb.from("event_artists").select("event_id, artist_id").in("event_id", eventIds),
    sb.from("event_organisers").select("event_id, organiser_id").in("event_id", eventIds),
  ]);
  const artistsByEvent = new Map<string, Set<string>>();
  for (const r of eventArtistRows ?? []) {
    const set = artistsByEvent.get((r as any).event_id) ?? new Set();
    set.add((r as any).artist_id);
    artistsByEvent.set((r as any).event_id, set);
  }
  const organisersByEvent = new Map<string, Set<string>>();
  for (const r of eventOrganiserRows ?? []) {
    const set = organisersByEvent.get((r as any).event_id) ?? new Set();
    set.add((r as any).organiser_id);
    organisersByEvent.set((r as any).event_id, set);
  }

  // Step 4: per-user resolve. For each fav row, find matching events.
  const perUser = new Map<string, Set<string>>(); // user_id → Set<event_id>
  function add(userId: string, eventId: string) {
    const set = perUser.get(userId) ?? new Set();
    set.add(eventId);
    perUser.set(userId, set);
  }
  for (const fav of allFavourites ?? []) {
    const f = fav as any;
    if (f.target_type === "event") {
      if (eventIds.includes(f.target_id)) add(f.user_id, f.target_id);
    } else if (f.target_type === "venue") {
      for (const e of events) {
        if ((e as any).venue_id === f.target_id) add(f.user_id, (e as any).id);
      }
    } else if (f.target_type === "artist") {
      for (const [eid, artists] of artistsByEvent.entries()) {
        if (artists.has(f.target_id)) add(f.user_id, eid);
      }
    } else if (f.target_type === "organiser") {
      for (const [eid, orgs] of organisersByEvent.entries()) {
        if (orgs.has(f.target_id)) add(f.user_id, eid);
      }
    }
  }

  if (perUser.size === 0) {
    return NextResponse.json({
      ok: true,
      sent: 0,
      eventsConsidered: events.length,
      message: "No users had favourites happening today.",
    });
  }

  // Step 5: profiles + prefs + dedup
  const userIds = Array.from(perUser.keys());
  const { data: profiles } = await sb
    .from("profiles")
    .select("id, email, display_name, notification_prefs")
    .in("id", userIds);
  const profileById = new Map<string, any>();
  for (const p of profiles ?? []) profileById.set((p as any).id, p);

  const { data: alreadySent } = await sb
    .from("notifications_sent")
    .select("user_id, event_id")
    .eq("notification_type", NOTIFICATION_TYPE)
    .gte("sent_at", todayStartUK.toISOString())
    .in("user_id", userIds);
  const sentKey = (uid: string, eid: string) => `${uid}|${eid}`;
  const alreadySentSet = new Set<string>(
    (alreadySent ?? []).map((r: any) => sentKey(r.user_id, r.event_id)),
  );

  function formatWhen(iso: string): string {
    const d = new Date(iso);
    return d.toLocaleString("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "Europe/London",
    });
  }

  let sent = 0;
  let skipped = 0;
  const sendErrors: string[] = [];

  for (const [userId, eventSet] of perUser.entries()) {
    const profile = profileById.get(userId);
    if (!profile?.email) {
      skipped += 1;
      continue;
    }
    const prefs = profile.notification_prefs ?? {};
    if (prefs.morning_of_reminder === false) {
      skipped += 1;
      continue;
    }

    const freshEventIds = Array.from(eventSet).filter(
      (eid) => !alreadySentSet.has(sentKey(userId, eid)),
    );
    if (freshEventIds.length === 0) {
      skipped += 1;
      continue;
    }
    const items = freshEventIds
      .map((eid) => events.find((e: any) => e.id === eid))
      .filter(Boolean)
      .map((e: any) => ({
        title: e.title,
        when: formatWhen(e.start_time),
        venueName: e.venue?.name ?? "—",
        citySlug: e.venue?.city?.slug ?? "dundee",
        eventId: e.id,
      }));
    if (items.length === 0) continue;

    if (dry) {
      sent += 1;
      continue;
    }
    const ok = await notifyMorningOf({
      userEmail: profile.email,
      displayName: profile.display_name ?? null,
      items,
    });
    if (!ok) {
      sendErrors.push(profile.email);
      continue;
    }
    sent += 1;

    // Same content over push, best-effort. Skip when prefs explicitly disable.
    const wantsPush = prefs.push !== false;
    if (wantsPush && items.length > 0) {
      const first = items[0];
      const title = items.length === 1
        ? `Tonight: ${first.title}`
        : `${items.length} of your saved gigs today`;
      const body = items.length === 1
        ? `${first.when} at ${first.venueName}`
        : `${first.title} (${first.when}) + ${items.length - 1} more`;
      void sendPushToUser(userId, {
        title,
        body,
        data: {
          type: "morning_of",
          eventIds: items.map((i) => i.eventId),
          firstEventId: first.eventId,
        },
      });
    }

    await sb.from("notifications_sent").insert(
      freshEventIds.map((eid) => ({
        user_id: userId,
        notification_type: NOTIFICATION_TYPE,
        event_id: eid,
      })),
    );
  }

  return NextResponse.json({
    ok: true,
    sent,
    skipped,
    eventsConsidered: events.length,
    usersConsidered: perUser.size,
    sendErrors: sendErrors.length > 0 ? sendErrors : undefined,
    dry,
  });
}
