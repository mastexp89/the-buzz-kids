// Push token registration endpoint.
//
// Mobile app calls this after login (and after token refresh) to register
// its Expo push token with the user's account.
//
// Auth: Bearer JWT from supabase.auth.getSession(). Same convention as
// /api/account/delete, which is also called from the mobile app.
//
// POST /api/push/register
//   body: { expoToken: string, platform: "ios"|"android"|"web", appVersion?: string }
//   → { ok: true }
//
// DELETE /api/push/register?token=<expoToken>
//   → { ok: true }    (idempotent — fine if token wasn't registered)
//
// Token uniqueness: device_tokens has UNIQUE(expo_token) so a sign-out +
// sign-in as a different user on the same device steals the token cleanly
// via UPSERT. Two users can't both receive pushes for the same physical
// device — last-signed-in wins, which is what you want.

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createServiceClient } from "@/lib/supabase/service";

async function authedUserId(req: Request): Promise<string | null> {
  const auth = req.headers.get("authorization");
  if (!auth?.startsWith("Bearer ")) return null;
  const token = auth.slice("Bearer ".length).trim();
  if (!token) return null;
  // We verify the JWT by asking the Supabase auth server to resolve it.
  // Service client would skip RLS entirely; we want the user identity.
  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
  const { data, error } = await sb.auth.getUser(token);
  if (error || !data.user) return null;
  return data.user.id;
}

const PLATFORMS = new Set(["ios", "android", "web"]);

export async function POST(req: Request) {
  // Authorization is OPTIONAL — mobile app registers the device token
  // on launch (anonymous) and re-registers after sign-in (user-linked).
  // Both paths land here. Anonymous = user_id stays NULL, signed-in =
  // user_id resolved from the Bearer JWT.
  const userId = await authedUserId(req);

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const expoToken = typeof body?.expoToken === "string" ? body.expoToken.trim() : "";
  const platform = typeof body?.platform === "string" ? body.platform.trim().toLowerCase() : "";
  const appVersion = typeof body?.appVersion === "string" ? body.appVersion.slice(0, 32) : null;

  if (!expoToken) {
    return NextResponse.json({ error: "expoToken is required" }, { status: 400 });
  }
  if (!expoToken.startsWith("ExponentPushToken[") && !expoToken.startsWith("ExpoPushToken[")) {
    return NextResponse.json(
      { error: "expoToken doesn't look like a valid Expo push token" },
      { status: 400 },
    );
  }
  if (!PLATFORMS.has(platform)) {
    return NextResponse.json({ error: "platform must be ios, android or web" }, { status: 400 });
  }

  // Upsert by token — the device, not the user, is the unique identity.
  // Three cases:
  //   - First-ever anonymous registration → row created with user_id = NULL
  //   - Anonymous device that just signed in → row's user_id flips to the
  //     signed-in user (so they start receiving user-scoped pushes)
  //   - Different user signing in on a shared device → user_id overwritten
  //     (most recent signed-in user wins; previous user no longer gets
  //     pushes for this device)
  const sb = createServiceClient();
  const { error } = await sb
    .from("device_tokens")
    .upsert(
      {
        user_id: userId, // null = anonymous
        expo_token: expoToken,
        platform,
        app_version: appVersion,
        last_seen_at: new Date().toISOString(),
      },
      { onConflict: "expo_token" },
    );
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request) {
  const userId = await authedUserId(req);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }
  const url = new URL(req.url);
  const token = (url.searchParams.get("token") ?? "").trim();
  if (!token) {
    return NextResponse.json({ error: "token query param is required" }, { status: 400 });
  }
  const sb = createServiceClient();
  // Scope the delete to this user so a hostile client can't unregister
  // someone else's device by guessing a token.
  const { error } = await sb
    .from("device_tokens")
    .delete()
    .eq("expo_token", token)
    .eq("user_id", userId);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
