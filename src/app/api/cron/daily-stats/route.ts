// Vercel Cron: every morning, post yesterday's site + app stats into the
// admins Telegram group — page views (with day-over-day change), clicks,
// top places, signups, events added, reviews, and app device numbers
// (new device registrations ≈ new installs; last-seen ≈ active devices).
//
// Auth: Vercel sends `Authorization: Bearer ${CRON_SECRET}`. ?dry=1 to
// compute without posting.

import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { sendTelegram, tgEsc } from "@/lib/telegram";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(req: Request) {
  const auth = req.headers.get("authorization");
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const dry = new URL(req.url).searchParams.get("dry") === "1";
  const sb = createServiceClient();

  // Yesterday's window in UK time.
  const now = new Date();
  const ukNow = new Date(now.toLocaleString("en-US", { timeZone: "Europe/London" }));
  const todayStart = new Date(
    now.getTime() - (ukNow.getHours() * 3600 + ukNow.getMinutes() * 60 + ukNow.getSeconds()) * 1000,
  );
  const dayMs = 24 * 3600 * 1000;
  const yStart = new Date(todayStart.getTime() - dayMs).toISOString();
  const yEnd = todayStart.toISOString();
  const y2Start = new Date(todayStart.getTime() - 2 * dayMs).toISOString();

  const count = async (table: string, filter: (q: any) => any) => {
    const { count: n } = await filter(sb.from(table).select("id", { count: "exact", head: true }));
    return n ?? 0;
  };

  const weekAgo = new Date(todayStart.getTime() - 7 * dayMs).toISOString();
  const [
    views, viewsPrev, clicks, signups, eventsAdded, reviews,
    newIos, newAndroid, totalIos, totalAndroid, activeIos, activeAndroid,
  ] = await Promise.all([
    count("page_views", (q) => q.eq("kind", "view").gte("viewed_at", yStart).lt("viewed_at", yEnd)),
    count("page_views", (q) => q.eq("kind", "view").gte("viewed_at", y2Start).lt("viewed_at", yStart)),
    count("page_views", (q) => q.neq("kind", "view").gte("viewed_at", yStart).lt("viewed_at", yEnd)),
    count("profiles", (q) => q.gte("created_at", yStart).lt("created_at", yEnd)),
    count("events", (q) => q.gte("created_at", yStart).lt("created_at", yEnd)),
    count("reviews", (q) => q.gte("created_at", yStart).lt("created_at", yEnd)),
    count("device_tokens", (q) => q.eq("platform", "ios").gte("created_at", yStart).lt("created_at", yEnd)),
    count("device_tokens", (q) => q.eq("platform", "android").gte("created_at", yStart).lt("created_at", yEnd)),
    count("device_tokens", (q) => q.eq("platform", "ios")),
    count("device_tokens", (q) => q.eq("platform", "android")),
    count("device_tokens", (q) => q.eq("platform", "ios").gte("last_seen_at", weekAgo)),
    count("device_tokens", (q) => q.eq("platform", "android").gte("last_seen_at", weekAgo)),
  ]);
  const newDevices = newIos + newAndroid;
  const totalDevices = totalIos + totalAndroid;
  const activeDevices = activeIos + activeAndroid;

  // Top 3 most-viewed places yesterday.
  const { data: viewRows } = await sb
    .from("page_views")
    .select("venue_id")
    .eq("kind", "view")
    .not("venue_id", "is", null)
    .gte("viewed_at", yStart)
    .lt("viewed_at", yEnd)
    .range(0, 19999);
  const tally = new Map<string, number>();
  for (const r of viewRows ?? []) tally.set(r.venue_id, (tally.get(r.venue_id) ?? 0) + 1);
  const topIds = [...tally.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
  let topLines = "";
  if (topIds.length) {
    const { data: topVenues } = await sb
      .from("venues")
      .select("id, name")
      .in("id", topIds.map(([id]) => id));
    const nameOf = new Map((topVenues ?? []).map((v) => [v.id, v.name]));
    topLines = topIds
      .map(([id, n], i) => `  ${["🥇", "🥈", "🥉"][i]} ${tgEsc(nameOf.get(id) ?? "—")} — ${n}`)
      .join("\n");
  }

  const delta = viewsPrev > 0 ? Math.round(((views - viewsPrev) / viewsPrev) * 100) : null;
  const deltaLabel = delta === null ? "" : delta >= 0 ? ` (▲ ${delta}%)` : ` (▼ ${Math.abs(delta)}%)`;

  if (dry) {
    return NextResponse.json({ ok: true, views, viewsPrev, clicks, signups, eventsAdded, reviews, newDevices, totalDevices, activeDevices, sent: false });
  }

  await sendTelegram(
    `📈 <b>The Buzz Kids — yesterday</b>\n` +
    `👀 Page views: ${views}${deltaLabel}\n` +
    `🔗 Link clicks: ${clicks}\n` +
    (topLines ? `Top places:\n${topLines}\n` : "") +
    `👨‍👧 New signups: ${signups}\n` +
    `🎪 Events added: ${eventsAdded}\n` +
    `📝 Reviews left: ${reviews}\n` +
    `📱 App devices <i>(push-registered, not store downloads)</i>:\n` +
    `  🍎 iOS — +${newIos} new · ${activeIos} active this week · ${totalIos} total\n` +
    (totalAndroid === 0
      ? `  🤖 Android — none ⚠️ push not configured (no FCM key), so Android devices never register`
      : `  🤖 Android — +${newAndroid} new · ${activeAndroid} active this week · ${totalAndroid} total`),
    { silent: true },
  );

  return NextResponse.json({ ok: true, views, clicks, signups, eventsAdded, newDevices, sent: true });
}
