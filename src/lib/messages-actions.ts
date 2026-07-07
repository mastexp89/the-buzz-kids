"use server";

// Messaging server actions used by admin + user UIs.

import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { revalidatePath } from "next/cache";
import { sendAdminEmail } from "@/lib/email";
import { buildEmailHtml, buildEmailText, type EmailBlock } from "@/lib/email-template";
import { sendPushToUser } from "@/lib/push";

const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.thebuzzguide.co.uk";
const ADMIN_NOTIFY_EMAIL = process.env.ADMIN_NOTIFY_EMAIL ?? "hello@thebuzzkids.co.uk";

export type Message = {
  id: string;
  user_id: string;
  from_admin: boolean;
  body: string;
  read_at: string | null;
  created_at: string;
};

async function getCtx() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: profile } = await supabase
    .from("profiles")
    .select("role, email, display_name")
    .eq("id", user.id)
    .maybeSingle();
  return {
    supabase,
    user,
    role: profile?.role ?? "user",
    email: profile?.email ?? user.email ?? null,
    displayName: profile?.display_name ?? null,
  };
}

// ---------- USER side ----------

export async function listMyMessages(): Promise<Message[]> {
  const ctx = await getCtx();
  if (!ctx) return [];
  const { data } = await ctx.supabase
    .from("messages")
    .select("*")
    .eq("user_id", ctx.user.id)
    .order("created_at", { ascending: true });
  return (data ?? []) as Message[];
}

export async function getMyUnreadCount(): Promise<number> {
  const ctx = await getCtx();
  if (!ctx) return 0;
  const { count } = await ctx.supabase
    .from("messages")
    .select("id", { count: "exact", head: true })
    .eq("user_id", ctx.user.id)
    .eq("from_admin", true)
    .is("read_at", null);
  return count ?? 0;
}

export async function markMyMessagesRead(): Promise<{ ok: true } | { error: string }> {
  const ctx = await getCtx();
  if (!ctx) return { error: "Not signed in." };
  const { error } = await ctx.supabase
    .from("messages")
    .update({ read_at: new Date().toISOString() })
    .eq("user_id", ctx.user.id)
    .eq("from_admin", true)
    .is("read_at", null);
  if (error) return { error: error.message };
  revalidatePath("/dashboard/messages");
  return { ok: true };
}

export async function sendMyMessage(body: string): Promise<{ ok: true } | { error: string }> {
  const ctx = await getCtx();
  if (!ctx) return { error: "Not signed in." };
  const trimmed = (body ?? "").trim();
  if (trimmed.length === 0) return { error: "Message can't be empty." };
  if (trimmed.length > 5000) return { error: "Message too long." };

  const { error } = await ctx.supabase
    .from("messages")
    .insert({ user_id: ctx.user.id, from_admin: false, body: trimmed });
  if (error) return { error: error.message };

  // Email admin
  notifyAdminOfNewMessage({
    fromName: ctx.displayName,
    fromEmail: ctx.email,
    body: trimmed,
    userId: ctx.user.id,
  }).catch(() => {});

  revalidatePath("/dashboard/messages");
  revalidatePath("/admin/messages");
  return { ok: true };
}

// ---------- ADMIN side ----------

async function requireDylanAdmin() {
  const ctx = await getCtx();
  if (!ctx) return null;
  if (ctx.role !== "admin") return null;
  return ctx;
}

export type ConversationSummary = {
  user_id: string;
  email: string | null;
  display_name: string | null;
  role: string | null;
  last_body: string;
  last_at: string;
  last_from_admin: boolean;
  unread_from_user: number;
};

export async function listConversations(): Promise<ConversationSummary[]> {
  const ctx = await requireDylanAdmin();
  if (!ctx) return [];

  const sb = createServiceClient();
  // Pull last message per user via aggregating in JS — fine for up to thousands of rows.
  const { data: rows } = await sb
    .from("messages")
    .select("user_id, body, created_at, from_admin, read_at")
    .order("created_at", { ascending: false });

  const byUser = new Map<string, ConversationSummary & { _userId: string }>();
  for (const r of rows ?? []) {
    if (!byUser.has(r.user_id)) {
      byUser.set(r.user_id, {
        user_id: r.user_id,
        email: null,
        display_name: null,
        role: null,
        last_body: r.body,
        last_at: r.created_at,
        last_from_admin: r.from_admin,
        unread_from_user: 0,
        _userId: r.user_id,
      });
    }
    if (!r.from_admin && !r.read_at) {
      const cur = byUser.get(r.user_id)!;
      cur.unread_from_user += 1;
    }
  }

  // Hydrate profile info
  const userIds = Array.from(byUser.keys());
  if (userIds.length > 0) {
    const { data: profiles } = await sb
      .from("profiles")
      .select("id, email, display_name, role")
      .in("id", userIds);
    for (const p of profiles ?? []) {
      const conv = byUser.get(p.id);
      if (conv) {
        conv.email = p.email;
        conv.display_name = p.display_name;
        conv.role = p.role;
      }
    }
  }

  return Array.from(byUser.values()).sort(
    (a, b) => new Date(b.last_at).getTime() - new Date(a.last_at).getTime(),
  );
}

export async function listThreadForAdmin(userId: string): Promise<{
  ok: true;
  messages: Message[];
  user: { id: string; email: string | null; display_name: string | null; role: string | null };
} | { error: string }> {
  const ctx = await requireDylanAdmin();
  if (!ctx) return { error: "Not authorised." };

  const sb = createServiceClient();
  const [{ data: msgs }, { data: profile }] = await Promise.all([
    sb.from("messages").select("*").eq("user_id", userId).order("created_at", { ascending: true }),
    sb.from("profiles").select("id, email, display_name, role").eq("id", userId).maybeSingle(),
  ]);
  if (!profile) return { error: "User not found." };
  return {
    ok: true,
    messages: (msgs ?? []) as Message[],
    user: profile as any,
  };
}

export async function sendAdminMessage(opts: {
  userId: string;
  body: string;
}): Promise<{ ok: true } | { error: string }> {
  const ctx = await requireDylanAdmin();
  if (!ctx) return { error: "Not authorised." };

  const trimmed = (opts.body ?? "").trim();
  if (!trimmed) return { error: "Message can't be empty." };
  if (trimmed.length > 5000) return { error: "Message too long." };

  const sb = createServiceClient();
  const { error } = await sb.from("messages").insert({
    user_id: opts.userId,
    from_admin: true,
    body: trimmed,
  });
  if (error) return { error: error.message };

  // Email user
  const { data: profile } = await sb
    .from("profiles")
    .select("email, display_name")
    .eq("id", opts.userId)
    .maybeSingle();
  if (profile?.email) {
    notifyUserOfNewMessage({
      toEmail: profile.email,
      toName: profile.display_name ?? null,
      body: trimmed,
      userId: opts.userId,
    }).catch(() => {});
  }

  // Push the same message to the user's mobile devices. Title is generic
  // so it reads sensibly on the lock screen; full body is truncated to
  // ~120 chars (Expo will truncate anyway, but doing it cleanly here
  // avoids mid-word cuts).
  void sendPushToUser(opts.userId, {
    title: "New message from The Buzz Kids",
    body: trimmed.length > 120 ? `${trimmed.slice(0, 117).trim()}…` : trimmed,
    // NOTE: the kids app has no /inbox screen (music-era leftover), and its
    // tap handler routes type "admin_message" there → a "screen doesn't
    // exist" page. "broadcast" is unmapped, so tapping just opens the app.
    // Revisit when the app grows an inbox (see mobile-app-sync.md).
    data: { type: "broadcast" },
  });

  revalidatePath("/admin/messages");
  revalidatePath(`/admin/messages/${opts.userId}`);
  revalidatePath("/dashboard/messages");
  return { ok: true };
}

export async function markAdminThreadRead(userId: string): Promise<{ ok: true } | { error: string }> {
  const ctx = await requireDylanAdmin();
  if (!ctx) return { error: "Not authorised." };
  const sb = createServiceClient();
  const { error } = await sb
    .from("messages")
    .update({ read_at: new Date().toISOString() })
    .eq("user_id", userId)
    .eq("from_admin", false)
    .is("read_at", null);
  if (error) return { error: error.message };
  revalidatePath("/admin/messages");
  return { ok: true };
}

// ---------- Email helpers ----------

async function notifyUserOfNewMessage(opts: { toEmail: string; toName: string | null; body: string; userId: string }) {
  // One-tap sign-in link straight into the user's messages thread.
  // Uses the same magic-link mechanism as admin impersonation so the user
  // doesn't have to remember a password to reply.
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
    { kind: "p", text: "The Buzz Guide team sent you a new message:" },
    { kind: "p", text: `"${opts.body.slice(0, 600)}${opts.body.length > 600 ? "…" : ""}"` },
    { kind: "button", href: buttonUrl, text: "Reply on The Buzz Guide" },
    { kind: "small", text: "One-tap sign-in. The link expires after one click — request a new one any time by signing in normally." },
  ];

  return sendAdminEmail({
    to: opts.toEmail,
    subject: "New message on The Buzz Guide",
    text: buildEmailText(blocks),
    html: buildEmailHtml({ preheader: "New message from The Buzz Guide team.", blocks }),
  });
}

function notifyAdminOfNewMessage(opts: {
  fromName: string | null;
  fromEmail: string | null;
  body: string;
  userId: string;
}) {
  const fromLabel = `${opts.fromName ?? "—"} <${opts.fromEmail ?? "—"}>`;
  const blocks: EmailBlock[] = [
    { kind: "h", text: "New message from a user" },
    { kind: "kv", pairs: [["From", fromLabel]] },
    { kind: "p", text: `"${opts.body.slice(0, 600)}${opts.body.length > 600 ? "…" : ""}"` },
    { kind: "button", href: `${SITE}/admin/messages/${opts.userId}`, text: "Reply in admin" },
  ];
  return sendAdminEmail({
    to: ADMIN_NOTIFY_EMAIL,
    subject: `New message from ${opts.fromName ?? opts.fromEmail ?? "a user"}`,
    text: buildEmailText(blocks),
    html: buildEmailHtml({ preheader: "Reply at /admin/messages.", blocks }),
  });
}


// ---------- Broadcast (admin → all users) ----------

export type BroadcastTargetRole = "all" | "venue_owner" | "artist" | "event_organiser" | "user";

export type BroadcastResult =
  | { ok: true; sent: number; emailed: number; pushed: number; skipped: number }
  | { error: string };

export async function broadcastMessage(opts: {
  body: string;
  roleFilter: BroadcastTargetRole;
  email: boolean;
  // When true, also fire a push notification to every recipient's
  // registered mobile devices. Best-effort. Independent of the
  // email + in-app insert above — admins can tick any combination
  // (e.g. push-only when there's a time-sensitive nudge).
  push?: boolean;
  // Optional custom title for the push (defaults to "Message from The Buzz Guide")
  pushTitle?: string;
  // When true (with push=true), the push also goes to every anonymous
  // device — phones with the app installed where no user has signed in
  // yet. Anonymous devices have no inbox so they don't receive the
  // in-app message — push only.
  includeAnonymous?: boolean;
  // App-only mode: a push notification to EVERY device with the app
  // (signed-in and anonymous alike) and nothing else — no inbox rows,
  // no emails. For app announcements ("we've launched X").
  appOnly?: boolean;
}): Promise<BroadcastResult> {
  const ctx = await requireDylanAdmin();
  if (!ctx) return { error: "Not authorised." };

  const trimmed = (opts.body ?? "").trim();
  if (!trimmed) return { error: "Message can't be empty." };
  if (trimmed.length > 5000) return { error: "Message too long." };

  if (opts.appOnly) {
    const { sendPushToAllDevices } = await import("@/lib/push");
    const result = await sendPushToAllDevices(
      {
        title: opts.pushTitle?.trim() || "The Buzz Kids",
        body: trimmed.length > 120 ? `${trimmed.slice(0, 117).trim()}…` : trimmed,
    data: { type: "broadcast" },
      },
      { includeAnonymous: true },
    );
    revalidatePath("/admin/messages");
    return { ok: true, sent: 0, emailed: 0, pushed: result.sent, skipped: 0 };
  }

  const sb = createServiceClient();
  let q = sb.from("profiles").select("id, email, display_name, role");
  if (opts.roleFilter !== "all") q = q.eq("role", opts.roleFilter);
  const { data: targets, error: tErr } = await q;
  if (tErr) return { error: `Fetch users: ${tErr.message}` };
  if (!targets || targets.length === 0) return { error: "No matching users." };

  // Don't include admins (don't message yourself)
  const recipients = targets.filter((t) => t.role !== "admin" && t.id !== ctx.user.id);
  if (recipients.length === 0) return { error: "No non-admin users matched." };

  // Insert one message per recipient
  const rows = recipients.map((r) => ({
    user_id: r.id,
    from_admin: true,
    body: trimmed,
  }));
  const { error: insErr } = await sb.from("messages").insert(rows);
  if (insErr) return { error: `Failed to insert messages: ${insErr.message}` };

  // Optional emails — best-effort, capped to avoid flooding Resend's free tier
  let emailed = 0;
  let skipped = 0;
  if (opts.email) {
    const cap = 100; // Resend free tier = 100 emails/day; bigger broadcasts skip the email
    for (const r of recipients) {
      if (emailed >= cap) { skipped += 1; continue; }
      if (!r.email) { skipped += 1; continue; }
      try {
        await notifyUserOfNewMessage({
          toEmail: r.email,
          toName: r.display_name ?? null,
          body: trimmed,
          userId: r.id,
        });
        emailed += 1;
      } catch {
        skipped += 1;
      }
    }
  }

  // Optional push fan-out. Uses the batch helper so we resolve all
  // device tokens in one query and chunk per Expo's 100-message limit.
  let pushed = 0;
  if (opts.push) {
    const pushPayload = {
      title: opts.pushTitle?.trim() || "Message from The Buzz Kids",
      body: trimmed.length > 120 ? `${trimmed.slice(0, 117).trim()}…` : trimmed,
    data: { type: "broadcast" },
    };
    if (opts.includeAnonymous) {
      // "Everyone with the app" — both signed-in (filtered by role
      // above) and anonymous devices. Single query path; cleaner than
      // doing the per-recipient + anonymous fan-out separately.
      const { sendPushToAllDevices } = await import("@/lib/push");
      const roleMap: Record<string, ("user" | "venue_owner" | "artist" | "event_organiser")[] | undefined> = {
        all: undefined,
        user: ["user"],
        venue_owner: ["venue_owner"],
        artist: ["artist"],
        event_organiser: ["event_organiser"],
      };
      const result = await sendPushToAllDevices(pushPayload, {
        signedInRoles: roleMap[opts.roleFilter],
        includeAnonymous: true,
      });
      pushed = result.sent;
    } else {
      const { sendPushToUsers } = await import("@/lib/push");
      const result = await sendPushToUsers(
        recipients.map((r) => r.id),
        pushPayload,
      );
      pushed = result.sent;
    }
  }

  revalidatePath("/admin/messages");
  return { ok: true, sent: recipients.length, emailed, pushed, skipped };
}


// ---------- Compose: search users to start a thread ----------

export type ComposeUserOption = {
  id: string;
  email: string | null;
  display_name: string | null;
  role: string | null;
};

export async function searchUsersForCompose(query: string): Promise<ComposeUserOption[]> {
  const ctx = await requireDylanAdmin();
  if (!ctx) return [];
  const q = (query ?? "").trim();
  if (q.length < 2) return [];
  const sb = createServiceClient();
  const safe = q.replace(/[%_]/g, "");
  const { data } = await sb
    .from("profiles")
    .select("id, email, display_name, role")
    .or(`display_name.ilike.%${safe}%,email.ilike.%${safe}%`)
    .neq("role", "admin")
    .order("display_name", { ascending: true })
    .limit(10);
  return (data ?? []) as ComposeUserOption[];
}
