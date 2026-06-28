// Admin-only broadcast endpoint for the mobile admin dashboard.
//
// Posts a message to every user matching roleFilter, optionally with
// email + push fan-out. Mirrors the web's broadcastMessage action but
// works over JSON+Bearer so the mobile app can call it.
//
// POST /api/admin/broadcast
//   Authorization: Bearer <user JWT>
//   body: {
//     body: string,                    // message body
//     roleFilter: "all" | "user" | "venue_owner" | "artist" | "event_organiser",
//     email?: boolean,                 // also send emails (capped at 100)
//     push?: boolean,                  // also fire pushes to mobile
//     pushTitle?: string               // optional push title override
//   }
//   → { ok: true, sent, emailed, pushed, skipped }
//   → { error: string }
//
// Auth: requires the caller to have profiles.role === 'admin'.

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createServiceClient } from "@/lib/supabase/service";
import { sendPushToUsers } from "@/lib/push";

const ROLES = new Set(["all", "user", "venue_owner", "artist", "event_organiser"]);

async function authedAdminId(req: Request): Promise<string | null> {
  const auth = req.headers.get("authorization");
  if (!auth?.startsWith("Bearer ")) return null;
  const token = auth.slice("Bearer ".length).trim();
  if (!token) return null;
  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
  const { data, error } = await sb.auth.getUser(token);
  if (error || !data.user) return null;
  // Admin check via service client
  const svc = createServiceClient();
  const { data: prof } = await svc
    .from("profiles")
    .select("role")
    .eq("id", data.user.id)
    .maybeSingle();
  if (prof?.role !== "admin") return null;
  return data.user.id;
}

export async function POST(req: Request) {
  const adminId = await authedAdminId(req);
  if (!adminId) {
    return NextResponse.json({ error: "Admins only" }, { status: 401 });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const msgBody = typeof body?.body === "string" ? body.body.trim() : "";
  const roleFilter = typeof body?.roleFilter === "string" ? body.roleFilter : "";
  const wantsEmail = body?.email === true;
  const wantsPush = body?.push === true;
  const wantsAnonymous = body?.includeAnonymous === true;
  const pushTitle = typeof body?.pushTitle === "string" ? body.pushTitle.trim() : "";

  if (!msgBody) return NextResponse.json({ error: "Message can't be empty." }, { status: 400 });
  if (msgBody.length > 5000) {
    return NextResponse.json({ error: "Message too long (max 5000 chars)." }, { status: 400 });
  }
  if (!ROLES.has(roleFilter)) {
    return NextResponse.json({ error: "Invalid roleFilter." }, { status: 400 });
  }

  const sb = createServiceClient();
  let q = sb.from("profiles").select("id, email, display_name, role");
  if (roleFilter !== "all") q = q.eq("role", roleFilter);
  const { data: targets, error: tErr } = await q;
  if (tErr) return NextResponse.json({ error: `Fetch users: ${tErr.message}` }, { status: 500 });
  if (!targets || targets.length === 0) {
    return NextResponse.json({ error: "No matching users." }, { status: 404 });
  }

  // Skip admins (including self)
  const recipients = targets.filter((t: any) => t.role !== "admin" && t.id !== adminId);
  if (recipients.length === 0) {
    return NextResponse.json({ error: "No non-admin users matched." }, { status: 404 });
  }

  // Insert one message per recipient (lands in their inbox)
  const rows = recipients.map((r: any) => ({
    user_id: r.id,
    from_admin: true,
    body: msgBody,
  }));
  const { error: insErr } = await sb.from("messages").insert(rows);
  if (insErr) {
    return NextResponse.json({ error: `Failed to insert: ${insErr.message}` }, { status: 500 });
  }

  // Optional push fan-out — single batch query, chunked per Expo's 100-message limit.
  let pushed = 0;
  if (wantsPush) {
    const payload = {
      title: pushTitle || "Message from The Buzz Guide",
      body: msgBody.length > 120 ? `${msgBody.slice(0, 117).trim()}…` : msgBody,
      data: { type: "admin_message" },
    };
    if (wantsAnonymous) {
      // "Everyone with the app" path — also reach anonymous devices.
      const { sendPushToAllDevices } = await import("@/lib/push");
      const roleMap: Record<string, ("user" | "venue_owner" | "artist" | "event_organiser")[] | undefined> = {
        all: undefined,
        user: ["user"],
        venue_owner: ["venue_owner"],
        artist: ["artist"],
        event_organiser: ["event_organiser"],
      };
      const result = await sendPushToAllDevices(payload, {
        signedInRoles: roleMap[roleFilter],
        includeAnonymous: true,
      });
      pushed = result.sent;
    } else {
      const result = await sendPushToUsers(
        recipients.map((r: any) => r.id as string),
        payload,
      );
      pushed = result.sent;
    }
  }

  // Email is deliberately skipped from this mobile endpoint (Resend's 100/day
  // free cap is too easy to blow through from the road). Admins who want
  // bulk email should use the web /admin/messages/broadcast form which has
  // the safety chrome around it. The in-app message still goes out.
  void wantsEmail;

  return NextResponse.json({
    ok: true,
    sent: recipients.length,
    emailed: 0,
    pushed,
    skipped: 0,
  });
}
