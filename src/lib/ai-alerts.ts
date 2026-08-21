// One loud Telegram alert when the AI reader goes down for everyone.
//
// An exhausted Anthropic credit balance is invisible in the admins group: the
// FB scrape just reports "Events added: 0 · Errors: 8" and every poster upload
// quietly tells the user "poster reading is unavailable". On 21 Aug 2026 that
// ran all day before anyone worked out why.
//
// This posts a single card naming the actual cause, throttled through
// claim_admin_alert (sql/101) so a Friday sweep can't fire it 300 times.

import { createServiceClient } from "@/lib/supabase/service";
import { sendTelegram } from "@/lib/telegram";

// Long enough that a sweep is one alert, short enough to re-nag the next day
// if it's still broken.
const COOLDOWN_MINUTES = 6 * 60;

/** Out of credits specifically — not a rate limit, not a blip. Billing fixes it. */
export function isCreditsExhaustedError(err: unknown): boolean {
  const msg = String((err as any)?.message ?? err ?? "").toLowerCase();
  return msg.includes("credit balance is too low");
}

/**
 * Call on any Anthropic failure. Silent unless it's an outage worth waking
 * someone for, and even then at most once per cooldown. Never throws — an
 * alerting failure must not take down the thing it's reporting on.
 */
export async function noteAnthropicFailure(err: unknown): Promise<void> {
  try {
    if (!isCreditsExhaustedError(err)) return;

    const sb = createServiceClient();
    const { data, error } = await sb.rpc("claim_admin_alert", {
      p_key: "anthropic_credits_exhausted",
      p_cooldown_minutes: COOLDOWN_MINUTES,
    });
    // If the RPC is missing (migration not applied yet), stay quiet rather
    // than alerting on every single call.
    if (error || data !== true) return;

    await sendTelegram(
      `🚨 <b>Anthropic credits exhausted</b>\n` +
      `Every AI feature is down right now — poster reading (<code>/event</code>, ` +
      `web uploads), the website scrape and the review queue's ingest are all ` +
      `failing.\n\n` +
      `Top up at <b>console.anthropic.com → Plans &amp; Billing</b>. ` +
      `Everything resumes on its own once there's credit.`,
      {
        buttons: [[{ text: "💳 Anthropic billing", url: "https://console.anthropic.com/settings/billing" }]],
      },
    );
  } catch {
    /* alerting is best-effort */
  }
}
