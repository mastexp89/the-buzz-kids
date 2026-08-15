// Vercel Cron: every morning, sweep TODAY's listings for suspected
// duplicates (same place + same hour, or same place + very similar titles)
// and post each pair into the admins Telegram group with one-tap
// resolution: remove one, remove the other, or keep both.
//
// Complements /api/cron/dedupe-events (3am), which auto-merges only the
// high-confidence exact matches — this is the human pass for the fuzzy
// leftovers. Sends nothing when today is clean.
//
// Auth: Vercel sends `Authorization: Bearer ${CRON_SECRET}`. ?dry=1 to
// compute without posting.

import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { sendTelegram, tgEsc, tgDate } from "@/lib/telegram";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

const normTitle = (t: string) => (t || "").toLowerCase().replace(/[^a-z0-9]+/g, "");

const hourKey = (iso: string) => {
  const t = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}T${pad(t.getUTCHours())}`;
};

type Ev = {
  id: string;
  title: string;
  start_time: string;
  status: string;
  auto_imported_from: string | null;
  venue: { id: string; name: string } | null;
};

export async function GET(req: Request) {
  const auth = req.headers.get("authorization");
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const dry = new URL(req.url).searchParams.get("dry") === "1";
  const sb = createServiceClient();

  // Today's window in UK time.
  const now = new Date();
  const ukNow = new Date(now.toLocaleString("en-US", { timeZone: "Europe/London" }));
  const dayStart = new Date(
    now.getTime() - (ukNow.getHours() * 3600 + ukNow.getMinutes() * 60 + ukNow.getSeconds()) * 1000,
  );
  const dayEnd = new Date(dayStart.getTime() + 24 * 3600 * 1000);

  const { data: events } = await sb
    .from("events")
    .select("id, title, start_time, status, auto_imported_from, venue:venues(id, name)")
    .in("status", ["approved", "pending"])
    .gte("start_time", dayStart.toISOString())
    .lt("start_time", dayEnd.toISOString())
    .order("start_time", { ascending: true });

  // Pair up suspects per place; each event lands in at most one pair.
  const byVenue = new Map<string, Ev[]>();
  for (const e of (events ?? []) as unknown as Ev[]) {
    const vid = e.venue?.id;
    if (!vid) continue;
    byVenue.set(vid, [...(byVenue.get(vid) ?? []), e]);
  }

  const pairs: [Ev, Ev][] = [];
  for (const list of byVenue.values()) {
    const used = new Set<string>();
    for (let i = 0; i < list.length; i++) {
      if (used.has(list[i].id)) continue;
      for (let j = i + 1; j < list.length; j++) {
        if (used.has(list[j].id)) continue;
        const a = list[i], b = list[j];
        const sameHour = hourKey(a.start_time) === hourKey(b.start_time);
        const na = normTitle(a.title), nb = normTitle(b.title);
        const similarTitle =
          na === nb ||
          (na.length >= 6 && nb.length >= 6 && (na.includes(nb) || nb.includes(na)));
        // Same activity, same place, hours apart is a legitimate repeat
        // session (morning + afternoon soft play, two show times) — not a
        // duplicate. Only treat matching titles as suspect when they're
        // close in time; a real duplicate lands within the hour.
        const minutesApart =
          Math.abs(new Date(a.start_time).getTime() - new Date(b.start_time).getTime()) / 60000;
        if (sameHour || (similarTitle && minutesApart <= 90)) {
          pairs.push([a, b]);
          used.add(a.id);
          used.add(b.id);
          break;
        }
      }
    }
  }

  if (pairs.length === 0 || dry) {
    return NextResponse.json({ ok: true, pairs: pairs.length, sent: false });
  }

  const shown = pairs.slice(0, 10);
  await sendTelegram(
    `🔍 <b>Buzz Kids duplicate check — today's events</b>\n` +
    `${pairs.length} suspect pair${pairs.length === 1 ? "" : "s"} need${pairs.length === 1 ? "s" : ""} a look` +
    (pairs.length > shown.length ? ` (showing first ${shown.length})` : "") + `:`,
  );
  const srcLabel = (e: Ev) =>
    e.auto_imported_from ? `via ${e.auto_imported_from}` : "manual";
  for (const [a, b] of shown) {
    await sendTelegram(
      `📍 <b>${tgEsc(a.venue?.name ?? "—")}</b>\n` +
      `1️⃣ ${tgEsc(a.title)}\n     ${tgEsc(tgDate(a.start_time))} · ${tgEsc(srcLabel(a))} · ${a.status}\n` +
      `2️⃣ ${tgEsc(b.title)}\n     ${tgEsc(tgDate(b.start_time))} · ${tgEsc(srcLabel(b))} · ${b.status}`,
      {
        silent: true,
        buttons: [
          [
            { text: "🗑 Remove 1️⃣", callback_data: `ev:rj:${a.id}` },
            { text: "🗑 Remove 2️⃣", callback_data: `ev:rj:${b.id}` },
          ],
          [{ text: "✋ Both fine — keep them", callback_data: `dd:ok:${a.id}` }],
        ],
      },
    );
  }

  return NextResponse.json({ ok: true, pairs: pairs.length, sent: true });
}
