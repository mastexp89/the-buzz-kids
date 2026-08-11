// Shared "post the pending events into the group with Approve/Reject
// buttons" helper — used by both the Telegram webhook's /pending command
// and the morning queue-digest cron.

import { createServiceClient } from "@/lib/supabase/service";
import { sendTelegram, tgEsc, tgDate } from "@/lib/telegram";

/**
 * Post the newest aggregator-discovered places as cards with a one-tap
 * Dismiss — used by the morning digest and /pending. Adding a place stays
 * a web-admin job (it needs details filled in), so that side is a link.
 */
export async function sendAggregatorPlaceCards(limit = 5): Promise<number> {
  const sb = createServiceClient();
  const { data: places } = await sb
    .from("aggregator_places")
    .select("id, name, location, website, source_url, city_slug, found_at")
    .eq("status", "new")
    .order("found_at", { ascending: true })
    .limit(limit);
  const site = process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.thebuzzkids.co.uk";
  for (const p of places ?? []) {
    const linkRow = [
      ...(p.website ? [{ text: "🌐 Website", url: p.website }] : []),
      ...(p.source_url ? [{ text: "🔍 Where we found it", url: p.source_url }] : []),
      { text: "✏️ Admin", url: `${site}/admin/aggregator` },
    ];
    await sendTelegram(
      `📍 <b>Place to add</b> — ${tgEsc(p.name)}\n` +
      `Area: ${tgEsc(p.location ?? "—")} · Region: ${tgEsc(p.city_slug ?? "—")}\n` +
      (p.website ? `${tgEsc(p.website)}\n` : "") +
      `Adding publishes it now — address, photos and hours fill in automatically within the hour.`,
      {
        silent: true,
        buttons: [
          [
            { text: "➕ Add place", callback_data: `ag:ad:${p.id}` },
            { text: "🙈 Dismiss", callback_data: `ag:di:${p.id}` },
          ],
          linkRow,
        ],
      },
    );
  }
  return (places ?? []).length;
}

export async function sendPendingEventButtons(limit = 5): Promise<number> {
  const sb = createServiceClient();
  const { data: pendingEvents } = await sb
    .from("events")
    .select("id, title, start_time, venue:venues(name)")
    .eq("status", "pending")
    .order("created_at", { ascending: true })
    .limit(limit);
  for (const ev of pendingEvents ?? []) {
    await sendTelegram(
      `🎪 <b>${tgEsc(ev.title)}</b>\n` +
      `📍 ${tgEsc((ev.venue as any)?.name ?? "—")} · 🗓 ${tgEsc(tgDate(ev.start_time))}\n` +
      `ID: <code>${ev.id}</code>`,
      {
        silent: true,
        buttons: [[
          { text: "✅ Approve", callback_data: `ev:ap:${ev.id}` },
          { text: "❌ Reject", callback_data: `ev:rj:${ev.id}` },
        ]],
      },
    );
  }
  return (pendingEvents ?? []).length;
}
