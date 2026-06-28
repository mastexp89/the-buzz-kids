// Expo Push API wrapper.
//
// Single source of truth for sending push notifications to the mobile app.
// Looks up the user's registered device tokens in `device_tokens` and fans
// out via Expo's push service.
//
// Required env vars:
//   EXPO_ACCESS_TOKEN  (recommended — see https://docs.expo.dev/push-notifications/sending-notifications/#additional-security)
//                       Sends work without it but rate limits are much
//                       tighter and you can't ID your traffic in the Expo
//                       dashboard.
//
// Token cleanup: Expo returns "DeviceNotRegistered" for tokens that have
// been uninstalled / signed out. We delete those rows so we stop sending
// to dead devices. Other errors are logged but the row stays — could be
// a transient Expo issue.
//
// All sends are best-effort: failures log + return false, never throw.

import { createServiceClient } from "@/lib/supabase/service";

export type PushPayload = {
  title: string;
  body: string;
  // Arbitrary JSON delivered alongside the push, used by the mobile app
  // to deep-link (e.g. { type: "event", eventId: "abc-123" }).
  data?: Record<string, unknown>;
  // iOS-only "ding". Defaults to "default". Pass null to send silent.
  sound?: "default" | null;
  // Optional badge count on the app icon (iOS). Useful for the inbox.
  badge?: number;
  // Android channel id — see expo-notifications setChannelAsync().
  channelId?: string;
};

type ExpoMessage = {
  to: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
  sound?: "default" | null;
  badge?: number;
  channelId?: string;
};

type ExpoTicket = {
  status: "ok" | "error";
  id?: string;
  message?: string;
  details?: { error?: string };
};

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";

/**
 * Fire a push to every device registered to this user. Returns the count
 * of devices that received it. Logs + cleans up dead tokens automatically.
 */
export async function sendPushToUser(
  userId: string,
  payload: PushPayload,
): Promise<{ sent: number; pruned: number }> {
  const sb = createServiceClient();
  const { data: tokens, error } = await sb
    .from("device_tokens")
    .select("expo_token")
    .eq("user_id", userId);
  if (error) {
    console.warn("[push] failed to read tokens for user", userId, error.message);
    return { sent: 0, pruned: 0 };
  }
  const tokenList = (tokens ?? []).map((r: any) => r.expo_token as string);
  if (tokenList.length === 0) return { sent: 0, pruned: 0 };
  return sendPushToTokens(tokenList, payload);
}

/**
 * Batch version. Pass a list of user ids; we resolve their tokens in a
 * single query and fan out together. Use this from cron jobs that
 * notify many users in one go to avoid N+1 token lookups.
 */
export async function sendPushToUsers(
  userIds: string[],
  payload: PushPayload,
): Promise<{ sent: number; pruned: number }> {
  if (userIds.length === 0) return { sent: 0, pruned: 0 };
  const sb = createServiceClient();
  const { data: tokens, error } = await sb
    .from("device_tokens")
    .select("expo_token")
    .in("user_id", userIds);
  if (error) {
    console.warn("[push] failed to read tokens for users batch", error.message);
    return { sent: 0, pruned: 0 };
  }
  const tokenList = Array.from(new Set((tokens ?? []).map((r: any) => r.expo_token as string)));
  if (tokenList.length === 0) return { sent: 0, pruned: 0 };
  return sendPushToTokens(tokenList, payload);
}

/**
 * Fan-out to EVERY registered device — signed-in + anonymous. Used by
 * the admin broadcast tool's "everyone with the app" option to reach
 * users who downloaded the app but never created an account.
 *
 * Optional roleFilter restricts to specific user roles (still + all
 * anonymous tokens by default). Pass null to include anonymous-only,
 * or omit to include everyone signed-in + anonymous.
 */
export async function sendPushToAllDevices(
  payload: PushPayload,
  opts?: {
    // When set, restrict signed-in recipients to these roles. Anonymous
    // tokens are always included.
    signedInRoles?: ("user" | "venue_owner" | "artist" | "event_organiser")[];
    includeAnonymous?: boolean;
  },
): Promise<{ sent: number; pruned: number }> {
  const includeAnonymous = opts?.includeAnonymous !== false; // default true
  const sb = createServiceClient();

  const tokenSet = new Set<string>();

  // Signed-in tokens — optionally filtered by profile role.
  if (opts?.signedInRoles && opts.signedInRoles.length > 0) {
    const { data: profiles } = await sb
      .from("profiles")
      .select("id")
      .in("role", opts.signedInRoles);
    const userIds = (profiles ?? []).map((p: any) => p.id as string);
    if (userIds.length > 0) {
      const { data: linked } = await sb
        .from("device_tokens")
        .select("expo_token")
        .in("user_id", userIds);
      for (const r of linked ?? []) tokenSet.add(r.expo_token as string);
    }
  } else if (!opts?.signedInRoles) {
    // No role filter → include every signed-in token
    const { data: linked } = await sb
      .from("device_tokens")
      .select("expo_token")
      .not("user_id", "is", null);
    for (const r of linked ?? []) tokenSet.add(r.expo_token as string);
  }

  // Anonymous tokens (user_id IS NULL) — always included unless caller
  // explicitly opts out.
  if (includeAnonymous) {
    const { data: anon } = await sb
      .from("device_tokens")
      .select("expo_token")
      .is("user_id", null);
    for (const r of anon ?? []) tokenSet.add(r.expo_token as string);
  }

  if (tokenSet.size === 0) return { sent: 0, pruned: 0 };
  return sendPushToTokens(Array.from(tokenSet), payload);
}

/**
 * Low-level — sends a payload to an explicit list of tokens. Chunks into
 * batches of 100 (Expo's API limit) and walks responses to identify dead
 * tokens. Most callers want sendPushToUser / sendPushToUsers instead.
 */
export async function sendPushToTokens(
  tokens: string[],
  payload: PushPayload,
): Promise<{ sent: number; pruned: number }> {
  if (tokens.length === 0) return { sent: 0, pruned: 0 };
  const accessToken = process.env.EXPO_ACCESS_TOKEN;
  if (!accessToken) {
    console.info("[push] EXPO_ACCESS_TOKEN missing — sending unauthenticated (rate-limited)");
  }

  const messages: ExpoMessage[] = tokens.map((to) => ({
    to,
    title: payload.title.slice(0, 180), // safety
    body: payload.body.slice(0, 1000),
    data: payload.data,
    sound: payload.sound === undefined ? "default" : payload.sound,
    badge: payload.badge,
    channelId: payload.channelId,
  }));

  // Chunk into batches of 100 (Expo's documented max per request).
  const batches: ExpoMessage[][] = [];
  for (let i = 0; i < messages.length; i += 100) {
    batches.push(messages.slice(i, i + 100));
  }

  let totalSent = 0;
  const deadTokens: string[] = [];

  for (const batch of batches) {
    try {
      const res = await fetch(EXPO_PUSH_URL, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Accept-Encoding": "gzip, deflate",
          "Content-Type": "application/json",
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        },
        body: JSON.stringify(batch),
      });
      if (!res.ok) {
        const txt = await res.text().catch(() => "");
        console.warn("[push] expo non-2xx:", res.status, txt.slice(0, 200));
        continue;
      }
      const body = (await res.json()) as { data?: ExpoTicket[] };
      const tickets = body.data ?? [];
      tickets.forEach((t, i) => {
        if (t.status === "ok") {
          totalSent += 1;
          return;
        }
        const errCode = t.details?.error;
        if (errCode === "DeviceNotRegistered") {
          deadTokens.push(batch[i].to);
        } else {
          console.warn("[push] ticket error:", errCode ?? t.message, "token=", batch[i].to.slice(0, 20));
        }
      });
    } catch (e: any) {
      console.warn("[push] batch send failed:", e?.message ?? e);
    }
  }

  // Best-effort cleanup of dead tokens. Failure here just means we'll try
  // again on the next send and get the same DeviceNotRegistered back.
  let pruned = 0;
  if (deadTokens.length > 0) {
    const sb = createServiceClient();
    const { count } = await sb
      .from("device_tokens")
      .delete({ count: "exact" })
      .in("expo_token", deadTokens);
    pruned = count ?? 0;
  }

  return { sent: totalSent, pruned };
}
