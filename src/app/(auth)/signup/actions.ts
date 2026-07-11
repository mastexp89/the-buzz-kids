"use server";

// Fire-and-forget admin notification for new signups. Called from the
// signup page right after supabase.auth.signUp succeeds, before redirect.
// We don't gate on email confirmation — admins want to see the funnel
// (including the people who never confirm), and Resend will dedupe by
// subject + content in practice.

import { notifyNewSignup } from "@/lib/email";

export async function recordSignup(opts: {
  displayName: string | null;
  email: string | null;
  accountType: "venue" | "artist" | "organiser" | string;
}): Promise<{ ok: true }> {
  // Parent/fan signups are the norm (business self-serve is retired) and show
  // up in the admin People / competition lists already — emailing an alert for
  // every one is pure noise AND burns Resend quota during a competition rush.
  // Only notify for the rare business/claim signups worth a heads-up.
  const t = (opts.accountType || "").toLowerCase();
  const noisy = t === "fan" || t === "parent" || t === "user" || t === "";
  if (noisy) return { ok: true };
  try {
    await notifyNewSignup({
      displayName: opts.displayName,
      email: opts.email,
      accountType: opts.accountType,
    });
  } catch {
    // best-effort
  }
  return { ok: true };
}
