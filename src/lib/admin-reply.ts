// Send an admin reply into a user's in-app message thread WITHOUT a web
// session — used by the Telegram bot webhook when an admin replies to a
// "New message from a user" notification in the admins group.
//
// Deliberately a plain server lib (NOT a "use server" action file): the
// caller must already be trusted — the webhook authenticates via its
// secret token + admins-group gate. Mirrors sendAdminMessage in
// src/lib/messages-actions.ts (insert + email + push); keep in sync.

import { createServiceClient } from "@/lib/supabase/service";
import { sendAdminEmail } from "@/lib/email";
import { buildEmailHtml, buildEmailText, type EmailBlock } from "@/lib/email-template";
import { sendPushToUser } from "@/lib/push";

const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.thebuzzkids.co.uk";

export async function sendAdminReplyToUser(
  userId: string,
  body: string,
): Promise<{ ok: true; email: string | null; displayName: string | null } | { error: string }> {
  const trimmed = (body ?? "").trim();
  if (!trimmed) return { error: "Message can't be empty." };
  if (trimmed.length > 5000) return { error: "Message too long." };

  const sb = createServiceClient();

  const { data: profile } = await sb
    .from("profiles")
    .select("email, display_name")
    .eq("id", userId)
    .maybeSingle();
  if (!profile) return { error: "User not found." };

  const { error } = await sb.from("messages").insert({
    user_id: userId,
    from_admin: true,
    body: trimmed,
  });
  if (error) return { error: error.message };

  if (profile.email) {
    emailUser({
      toEmail: profile.email,
      toName: profile.display_name ?? null,
      body: trimmed,
    }).catch(() => {});
  }

  void sendPushToUser(userId, {
    title: "New message from The Buzz Kids",
    body: trimmed.length > 120 ? `${trimmed.slice(0, 117).trim()}…` : trimmed,
    data: { type: "admin_message" },
  });

  return { ok: true, email: profile.email ?? null, displayName: profile.display_name ?? null };
}

// Same one-tap magic-link email sendAdminMessage sends.
async function emailUser(opts: { toEmail: string; toName: string | null; body: string }) {
  let buttonUrl = `${SITE}/dashboard/messages`;
  try {
    const admin = createServiceClient();
    const { data, error } = await admin.auth.admin.generateLink({
      type: "magiclink",
      email: opts.toEmail,
      options: {
        redirectTo: `${SITE}/auth/magic-bridge?next=${encodeURIComponent("/dashboard/messages")}`,
      },
    });
    const link = (data as any)?.properties?.action_link as string | undefined;
    if (!error && link) buttonUrl = link;
  } catch {
    // Fall back to plain dashboard link if magic-link generation fails
  }

  const blocks: EmailBlock[] = [
    { kind: "h", text: "You have a new message" },
    { kind: "p", text: `Hi${opts.toName ? " " + opts.toName : ""},` },
    { kind: "p", text: "The Buzz Kids team sent you a new message:" },
    { kind: "p", text: `"${opts.body.slice(0, 600)}${opts.body.length > 600 ? "…" : ""}"` },
    { kind: "button", href: buttonUrl, text: "Reply on The Buzz Kids" },
    { kind: "small", text: "One-tap sign-in. The link expires after one click — request a new one any time by signing in normally." },
  ];

  return sendAdminEmail({
    to: opts.toEmail,
    subject: "New message on The Buzz Kids",
    text: buildEmailText(blocks),
    html: buildEmailHtml({ preheader: "New message from The Buzz Kids team.", blocks }),
  });
}
