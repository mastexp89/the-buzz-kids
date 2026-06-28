// Cron: notify followers about new gigs at venues / artists / organisers
// they've favourited.
//
// Runs hourly during waking hours (08:00–20:00 UTC). Finds events
// created in the last hour and matches them up with anyone following
// the venue, any tagged artist, or any tagged organiser. Each user
// gets ONE digest email per run with all their relevant new gigs.
//
// Idempotency: notifications_sent has a UNIQUE on (user_id, type,
// event_id). The pre-send check prevents duplicate emails if cron
// retries; the post-send INSERT prevents future retries from spamming
// the user even if a partial failure leaves some sends pending.
//
// Tunables:
//   ?dry=1     — don't send emails, just log what would be sent
//   ?window=N  — minutes back to look (default 75 = some overlap with
//                 the 60-min cron so nothing slips between runs)

import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { notifyFollowedGigsDigest } from "@/lib/email";
import { sendPushToUser } from "@/lib/push";

export const maxDuration = 60;

const NOTIFICATION_TYPE = "followed_gig_digest";

type DigestItem = {
  eventId: string;
  title: string;
  when: string;
  venueName: string;
  citySlug: string;
  reason: "venue" | "artist" | "organiser";
  reasonName: string;
};

export async function GET(req: Request) {
  const auth = req.headers.get("authorization");
  const expected = `Bearer ${process.env.CRON_SECRET ?? ""}`;
  if (!process.env.CRON_SECRET || auth !== expected) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }

  const url = new URL(req.url);
  const dry = url.searchParams.get("dry") === "1";
  const windowMinutes = Math.max(
    5,
    Math.min(1440, Number(url.searchParams.get("window") ?? 75)),
  );

  const sb = createServiceClient();
  const sinceIso = new Date(Date.now() - windowMinutes * 60 * 1000).toISOString();

  // Step 1: pull events created in the window. Only approved, only future,
  // and (via the festival visibility check) only those whose festival is
  // published or which have no festival. Mirrors the public events read
  // policy so we don't notify about drafts.
  const { data: events } = await sb
    .from("events")
    .select(
      "id, title, start_time, venue_id, festival_id, status, venue:venues(name, address, city:cities(slug, name))",
    )
    .gte("created_at", sinceIso)
    .eq("status", "approved")
    .gt("start_time", new Date().toISOString())
    .order("start_time");

  const approvedEvents = (events ?? []).filter((e: any) => {
    // Drop festival-linked events if their festival isn't published.
    // The publish gate normally lives in RLS but service client bypasses
    // it, so we replicate the rule here.
    if (!e.festival_id) return true;
    return false; // Will be filled in below via festival lookup
  });
  // Handle festival-linked events: only include those whose festival is published
  const festivalLinkedIds = (events ?? [])
    .filter((e: any) => e.festival_id)
    .map((e: any) => e.festival_id);
  const festivalLinkedUnique = Array.from(new Set(festivalLinkedIds));
  if (festivalLinkedUnique.length > 0) {
    const { data: publishedFestivals } = await sb
      .from("festivals")
      .select("id")
      .in("id", festivalLinkedUnique)
      .eq("published", true);
    const publishedSet = new Set((publishedFestivals ?? []).map((f: any) => f.id));
    for (const e of events ?? []) {
      if (e.festival_id && publishedSet.has(e.festival_id)) {
        approvedEvents.push(e);
      }
    }
  }

  if (approvedEvents.length === 0) {
    return NextResponse.json({ ok: true, sent: 0, message: "No new events in window." });
  }

  // Step 2: build follower lists per event from three sources.
  const eventIds = approvedEvents.map((e: any) => e.id);
  const venueIds = approvedEvents.map((e: any) => e.venue_id).filter(Boolean);

  const [{ data: venueFollows }, { data: eventArtistsRows }, { data: eventOrgsRows }] =
    await Promise.all([
      // followers via venue
      venueIds.length > 0
        ? sb
            .from("favourites")
            .select("user_id, target_id")
            .eq("target_type", "venue")
            .in("target_id", venueIds)
        : Promise.resolve({ data: [] as any[] }),
      // followers via artist
      sb
        .from("event_artists")
        .select("event_id, artist:artists(id, name)")
        .in("event_id", eventIds),
      // followers via organiser
      sb
        .from("event_organisers")
        .select("event_id, organiser:organisers(id, name)")
        .in("event_id", eventIds),
    ]);

  // Map artists/organisers per event
  const artistsByEvent = new Map<string, Array<{ id: string; name: string }>>();
  for (const r of eventArtistsRows ?? []) {
    const a = (r as any).artist;
    if (!a) continue;
    const list = artistsByEvent.get((r as any).event_id) ?? [];
    list.push(a);
    artistsByEvent.set((r as any).event_id, list);
  }
  const organisersByEvent = new Map<string, Array<{ id: string; name: string }>>();
  for (const r of eventOrgsRows ?? []) {
    const o = (r as any).organiser;
    if (!o) continue;
    const list = organisersByEvent.get((r as any).event_id) ?? [];
    list.push(o);
    organisersByEvent.set((r as any).event_id, list);
  }

  // Collect artist + organiser ids to look up their followers
  const allArtistIds = Array.from(
    new Set(Array.from(artistsByEvent.values()).flat().map((a) => a.id)),
  );
  const allOrganiserIds = Array.from(
    new Set(Array.from(organisersByEvent.values()).flat().map((o) => o.id)),
  );

  const [{ data: artistFollows }, { data: organiserFollows }] = await Promise.all([
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

  // Step 3: build per-user digest. Map: user_id → DigestItem[]
  const perUser = new Map<string, DigestItem[]>();

  function addItem(userId: string, item: DigestItem) {
    const list = perUser.get(userId) ?? [];
    // Skip if this event already in the list (same user followed both
    // venue and artist for one event — only mention it once).
    if (list.some((x) => x.eventId === item.eventId)) return;
    list.push(item);
    perUser.set(userId, list);
  }

  function formatWhen(iso: string): string {
    const d = new Date(iso);
    return d.toLocaleString("en-GB", {
      weekday: "short",
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "Europe/London",
    });
  }

  // Venue followers
  for (const f of venueFollows ?? []) {
    const eventsForVenue = approvedEvents.filter(
      (e: any) => e.venue_id === (f as any).target_id,
    );
    for (const e of eventsForVenue) {
      addItem((f as any).user_id, {
        eventId: e.id,
        title: e.title,
        when: formatWhen(e.start_time),
        venueName: (e.venue as any)?.name ?? "—",
        citySlug: (e.venue as any)?.city?.slug ?? "dundee",
        reason: "venue",
        reasonName: (e.venue as any)?.name ?? "this venue",
      });
    }
  }

  // Artist followers
  for (const f of artistFollows ?? []) {
    for (const [eventId, artists] of artistsByEvent.entries()) {
      const matched = artists.find((a) => a.id === (f as any).target_id);
      if (!matched) continue;
      const event = approvedEvents.find((e: any) => e.id === eventId);
      if (!event) continue;
      addItem((f as any).user_id, {
        eventId,
        title: event.title,
        when: formatWhen(event.start_time),
        venueName: (event.venue as any)?.name ?? "—",
        citySlug: (event.venue as any)?.city?.slug ?? "dundee",
        reason: "artist",
        reasonName: matched.name,
      });
    }
  }

  // Organiser followers
  for (const f of organiserFollows ?? []) {
    for (const [eventId, organisers] of organisersByEvent.entries()) {
      const matched = organisers.find((o) => o.id === (f as any).target_id);
      if (!matched) continue;
      const event = approvedEvents.find((e: any) => e.id === eventId);
      if (!event) continue;
      addItem((f as any).user_id, {
        eventId,
        title: event.title,
        when: formatWhen(event.start_time),
        venueName: (event.venue as any)?.name ?? "—",
        citySlug: (event.venue as any)?.city?.slug ?? "dundee",
        reason: "organiser",
        reasonName: matched.name,
      });
    }
  }

  if (perUser.size === 0) {
    return NextResponse.json({
      ok: true,
      sent: 0,
      eventsConsidered: approvedEvents.length,
      message: "No followers matched.",
    });
  }

  // Step 4: pre-filter users — must have a confirmed email + prefs allow
  // this notification + at least one event we haven't already notified
  // them about.
  const userIds = Array.from(perUser.keys());
  const { data: profiles } = await sb
    .from("profiles")
    .select("id, email, display_name, notification_prefs")
    .in("id", userIds);
  const profileById = new Map<string, any>();
  for (const p of profiles ?? []) profileById.set((p as any).id, p);

  // Existing sent records for these users + events
  const { data: alreadySent } = await sb
    .from("notifications_sent")
    .select("user_id, event_id")
    .eq("notification_type", NOTIFICATION_TYPE)
    .in("user_id", userIds)
    .in(
      "event_id",
      approvedEvents.map((e: any) => e.id),
    );
  const sentKey = (uid: string, eid: string) => `${uid}|${eid}`;
  const alreadySentSet = new Set<string>(
    (alreadySent ?? []).map((r: any) => sentKey(r.user_id, r.event_id)),
  );

  let sent = 0;
  let skipped = 0;
  const sendErrors: string[] = [];

  for (const [userId, allItems] of perUser.entries()) {
    const profile = profileById.get(userId);
    if (!profile?.email) {
      skipped += 1;
      continue;
    }
    const prefs = profile.notification_prefs ?? {};
    // Filter items by per-reason preference
    const items = allItems.filter((it) => {
      if (it.reason === "venue") return prefs.new_gig_at_favourite_venue !== false;
      if (it.reason === "artist") return prefs.new_gig_with_favourite_artist !== false;
      if (it.reason === "organiser") return prefs.new_gig_from_favourite_organiser !== false;
      return false;
    });
    // Filter out already-notified events
    const fresh = items.filter((it) => !alreadySentSet.has(sentKey(userId, it.eventId)));
    if (fresh.length === 0) {
      skipped += 1;
      continue;
    }
    if (dry) {
      sent += 1;
      continue;
    }
    const ok = await notifyFollowedGigsDigest({
      userEmail: profile.email,
      displayName: profile.display_name ?? null,
      items: fresh.map((f) => ({
        title: f.title,
        when: f.when,
        venueName: f.venueName,
        citySlug: f.citySlug,
        eventId: f.eventId,
        reason: f.reason,
        reasonName: f.reasonName,
      })),
    });
    if (!ok) {
      sendErrors.push(profile.email);
      continue;
    }
    sent += 1;

    // Fire a push alongside the email — same content, different channel.
    // Best-effort; failure here doesn't block the email-success accounting.
    // Skip push when prefs disable it (defaults to enabled if unset).
    const wantsPush = prefs.push !== false;
    if (wantsPush) {
      const sample = fresh[0];
      const title = fresh.length === 1
        ? `New gig: ${sample.title}`
        : `${fresh.length} new gigs from your favourites`;
      const body = fresh.length === 1
        ? `${sample.title} at ${sample.venueName} · ${sample.when}`
        : `${sample.title}${fresh.length > 1 ? ` + ${fresh.length - 1} more` : ""}`;
      void sendPushToUser(userId, {
        title,
        body,
        data: {
          type: "followed_gig_digest",
          eventIds: fresh.map((f) => f.eventId),
          firstEventId: sample.eventId,
        },
      });
    }

    // Mark every event in this digest as notified so we don't re-spam
    // tomorrow if the events haven't been deleted yet.
    await sb.from("notifications_sent").insert(
      fresh.map((f) => ({
        user_id: userId,
        notification_type: NOTIFICATION_TYPE,
        event_id: f.eventId,
      })),
    );
  }

  return NextResponse.json({
    ok: true,
    sent,
    skipped,
    eventsConsidered: approvedEvents.length,
    usersConsidered: perUser.size,
    sendErrors: sendErrors.length > 0 ? sendErrors : undefined,
    dry,
  });
}
