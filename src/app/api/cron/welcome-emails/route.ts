// Cron: drain the pending_welcome_emails queue.
//
// Rows land in this queue when a user clicks the Supabase confirmation
// link (auth.users.email_confirmed_at flips from NULL to a timestamp —
// see sql/044). This cron picks up unsent rows every few minutes, looks
// up display name + role from profiles, sends a tailored welcome email
// via Resend, and marks the row sent_at.
//
// Idempotency: pending_welcome_emails.user_id is PRIMARY KEY so each
// user can only be queued once. sent_at is the "did we already send?"
// flag — re-runs skip anything where it's set. Failed sends bump
// send_attempts and re-try; after 3 attempts we leave it alone.
//
// Tunables:
//   ?dry=1   — list what would be sent, no actual emails

import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { notifyWelcome } from "@/lib/email";

export const maxDuration = 60;

const MAX_PER_RUN = 30; // plenty of headroom — runs every 5 min
const MAX_ATTEMPTS = 3; // give up after 3 failed sends, leaves a paper trail

export async function GET(req: Request) {
  const auth = req.headers.get("authorization");
  const expected = `Bearer ${process.env.CRON_SECRET ?? ""}`;
  if (!process.env.CRON_SECRET || auth !== expected) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }
  const dry = new URL(req.url).searchParams.get("dry") === "1";

  const sb = createServiceClient();

  // 1. Pull a batch of unsent rows, oldest first so we never starve
  //    long-pending users.
  const { data: pending, error: pendingErr } = await sb
    .from("pending_welcome_emails")
    .select("user_id, email, account_type, send_attempts")
    .is("sent_at", null)
    .lt("send_attempts", MAX_ATTEMPTS)
    .order("queued_at", { ascending: true })
    .limit(MAX_PER_RUN);
  if (pendingErr) {
    return NextResponse.json({ error: pendingErr.message }, { status: 500 });
  }
  if (!pending || pending.length === 0) {
    return NextResponse.json({ ok: true, sent: 0, message: "Queue empty." });
  }

  // 2. Look up display names so the email can address the user by name.
  //    Role from profiles is a useful cross-check but we trust the
  //    account_type captured at signup time (in raw_user_meta_data) as
  //    the primary source for the welcome variant — that's what the
  //    user said they were.
  const userIds = pending.map((p: any) => p.user_id);
  const { data: profiles } = await sb
    .from("profiles")
    .select("id, display_name, role")
    .in("id", userIds);
  const profileById = new Map<string, any>();
  for (const p of profiles ?? []) profileById.set((p as any).id, p);

  let sent = 0;
  let failed = 0;
  const failures: string[] = [];

  for (const row of pending as any[]) {
    const profile = profileById.get(row.user_id);
    // account_type from the queue row reflects what they picked at signup.
    // Fall back to profile.role if signup metadata was missing (older
    // accounts before the metadata was being captured).
    const accountType: string =
      row.account_type ||
      profile?.role ||
      "user";

    if (dry) {
      sent++;
      continue;
    }

    const ok = await notifyWelcome({
      email: row.email,
      displayName: profile?.display_name ?? null,
      accountType,
    });

    if (ok) {
      await sb
        .from("pending_welcome_emails")
        .update({ sent_at: new Date().toISOString() })
        .eq("user_id", row.user_id);
      sent++;
    } else {
      await sb
        .from("pending_welcome_emails")
        .update({
          send_attempts: (row.send_attempts ?? 0) + 1,
          last_error: "resend send returned false",
        })
        .eq("user_id", row.user_id);
      failed++;
      failures.push(row.email);
    }
  }

  return NextResponse.json({
    ok: true,
    sent,
    failed,
    queueDrainedFromThisRun: pending.length,
    failures: failures.length > 0 ? failures : undefined,
    dry,
  });
}
