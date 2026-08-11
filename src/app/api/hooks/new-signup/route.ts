import { NextRequest, NextResponse } from "next/server";
import { tgNewSignup } from "@/lib/telegram";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/hooks/new-signup
 *
 * Called by a Postgres trigger (sql/099) whenever a profiles row is
 * created — which happens for EVERY signup, website or mobile app. This is
 * the single Telegram source for signup notifications: the app talks
 * straight to Supabase and never reaches the web server, so server-side
 * hooks alone can't see its signups.
 *
 * Auth: x-hook-secret header must match TELEGRAM_WEBHOOK_SECRET.
 */
export async function POST(req: NextRequest) {
  const expected = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!expected || req.headers.get("x-hook-secret") !== expected) {
    return NextResponse.json({ error: "Bad secret" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const record = body?.record;
  if (!record?.id) return NextResponse.json({ error: "No record" }, { status: 400 });

  await tgNewSignup({
    displayName: record.display_name ?? null,
    email: record.email ?? null,
    accountType: record.role ?? "parent",
  }).catch(() => {});

  return NextResponse.json({ ok: true });
}
