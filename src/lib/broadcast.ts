// Bulk newsletter / announcement sender. Builds a per-recipient email (each
// with its own unsubscribe link + List-Unsubscribe header), skips anyone on the
// unsubscribe list, and sends through Resend's batch endpoint (100 at a time).
import "server-only";
import { createServiceClient } from "@/lib/supabase/service";
import { buildEmailHtml, buildEmailText, type EmailBlock } from "@/lib/email-template";
import { unsubUrl } from "@/lib/unsubscribe";

export type BroadcastResult = { sent: number; skipped: number; failed: number; error?: string };

const chunk = <T,>(arr: T[], n: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
};

export async function sendBroadcast(opts: {
  subject: string;
  blocks: EmailBlock[];
  preheader?: string;
  recipients: string[];
  // Test sends bypass the unsubscribe list + go only to the given addresses.
  isTest?: boolean;
}): Promise<BroadcastResult> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.ADMIN_NOTIFY_FROM ?? "The Buzz Kids <noreply@thebuzzkids.co.uk>";
  if (!apiKey) return { sent: 0, skipped: 0, failed: 0, error: "Email isn't configured (RESEND_API_KEY missing)." };

  // Normalise + dedupe.
  const seen = new Set<string>();
  let list = opts.recipients
    .map((e) => (e || "").trim().toLowerCase())
    .filter((e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e))
    .filter((e) => (seen.has(e) ? false : (seen.add(e), true)));

  let skipped = 0;
  if (!opts.isTest && list.length > 0) {
    const sb = createServiceClient();
    const { data: unsubs } = await sb.from("email_unsubscribes").select("email");
    const off = new Set((unsubs ?? []).map((u: any) => (u.email || "").toLowerCase()));
    const before = list.length;
    list = list.filter((e) => !off.has(e));
    skipped = before - list.length;
  }

  if (list.length === 0) return { sent: 0, skipped, failed: 0 };

  let sent = 0;
  let failed = 0;
  for (const batch of chunk(list, 100)) {
    const payload = batch.map((email) => {
      const u = unsubUrl(email);
      return {
        from,
        to: [email],
        subject: opts.subject,
        html: buildEmailHtml({ preheader: opts.preheader, blocks: opts.blocks, unsubscribeUrl: opts.isTest ? undefined : u }),
        text: buildEmailText(opts.blocks, opts.isTest ? undefined : u),
        ...(opts.isTest ? {} : { headers: { "List-Unsubscribe": `<${u}>` } }),
      };
    });
    try {
      const res = await fetch("https://api.resend.com/emails/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify(payload),
      });
      if (res.ok) sent += batch.length;
      else failed += batch.length;
    } catch {
      failed += batch.length;
    }
  }

  return { sent, skipped, failed };
}
