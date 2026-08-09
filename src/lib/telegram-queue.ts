// Shared "post the pending events into the group with Approve/Reject
// buttons" helper — used by both the Telegram webhook's /pending command
// and the morning queue-digest cron.

import { createServiceClient } from "@/lib/supabase/service";
import { sendTelegram, tgEsc, tgDate } from "@/lib/telegram";

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
