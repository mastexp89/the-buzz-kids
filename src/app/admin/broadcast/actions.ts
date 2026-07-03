"use server";

import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { sendBroadcast } from "@/lib/broadcast";
import type { EmailBlock } from "@/lib/email-template";

async function requireAdmin() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: prof } = await supabase.from("profiles").select("role, email").eq("id", user.id).maybeSingle();
  return prof?.role === "admin" ? { user, email: prof.email ?? user.email ?? null } : null;
}

export type Audience = "waitlist" | "parents" | "both";
export type Compose = { subject: string; heading?: string; body: string; ctaLabel?: string; ctaUrl?: string };

function buildBlocks(input: Compose): EmailBlock[] {
  const blocks: EmailBlock[] = [];
  if (input.heading?.trim()) blocks.push({ kind: "h", text: input.heading.trim() });
  for (const para of input.body.split(/\n{2,}/).map((s) => s.trim()).filter(Boolean)) {
    blocks.push({ kind: "p", text: para });
  }
  if (input.ctaLabel?.trim() && input.ctaUrl?.trim()) {
    const raw = input.ctaUrl.trim();
    const href = raw.startsWith("http")
      ? raw
      : (process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.thebuzzkids.co.uk") + (raw.startsWith("/") ? raw : `/${raw}`);
    blocks.push({ kind: "button", href, text: input.ctaLabel.trim() });
  }
  return blocks;
}

async function resolveRecipients(audience: Audience): Promise<string[]> {
  const sb = createServiceClient();
  const set = new Set<string>();
  if (audience === "waitlist" || audience === "both") {
    const { data } = await sb.from("notify_signups").select("email").limit(100000);
    for (const r of data ?? []) if (r.email) set.add(String(r.email).toLowerCase());
  }
  if (audience === "parents" || audience === "both") {
    const { data } = await sb.from("profiles").select("email").eq("role", "user").limit(100000);
    for (const r of data ?? []) if (r.email) set.add(String(r.email).toLowerCase());
  }
  return Array.from(set);
}

export async function getAudienceCounts(): Promise<{ waitlist: number; parents: number; unsubscribed: number }> {
  if (!(await requireAdmin())) return { waitlist: 0, parents: 0, unsubscribed: 0 };
  const sb = createServiceClient();
  const [w, p, u] = await Promise.all([
    sb.from("notify_signups").select("email", { count: "exact", head: true }),
    sb.from("profiles").select("id", { count: "exact", head: true }).eq("role", "user"),
    sb.from("email_unsubscribes").select("email", { count: "exact", head: true }),
  ]);
  return { waitlist: w.count ?? 0, parents: p.count ?? 0, unsubscribed: u.count ?? 0 };
}

export async function sendTestBroadcast(input: Compose): Promise<{ ok?: true; error?: string }> {
  const admin = await requireAdmin();
  if (!admin) return { error: "Admins only." };
  if (!admin.email) return { error: "No email on your admin account to send a test to." };
  if (!input.subject.trim()) return { error: "Add a subject." };
  if (!input.body.trim()) return { error: "Write a message." };
  const res = await sendBroadcast({ subject: input.subject.trim(), blocks: buildBlocks(input), recipients: [admin.email], isTest: true });
  if (res.error) return { error: res.error };
  return { ok: true };
}

export async function sendBroadcastNow(
  input: Compose & { audience: Audience },
): Promise<{ ok?: true; error?: string; sent?: number; skipped?: number; failed?: number }> {
  if (!(await requireAdmin())) return { error: "Admins only." };
  if (!input.subject.trim()) return { error: "Add a subject." };
  if (!input.body.trim()) return { error: "Write a message." };
  const recipients = await resolveRecipients(input.audience);
  if (recipients.length === 0) return { error: "No recipients for that audience." };
  const res = await sendBroadcast({ subject: input.subject.trim(), blocks: buildBlocks(input), recipients });
  if (res.error) return { error: res.error };
  return { ok: true, sent: res.sent, skipped: res.skipped, failed: res.failed };
}
