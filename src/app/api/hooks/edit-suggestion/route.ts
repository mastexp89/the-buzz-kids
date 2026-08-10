import { NextRequest, NextResponse } from "next/server";
import { tgEditSuggestion } from "@/lib/telegram";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/hooks/edit-suggestion
 *
 * Called by a Postgres trigger (sql/098) whenever the MOBILE APP inserts an
 * edit_suggestions row directly into the database — the app writes with the
 * anon key and never touches the web server, so the normal
 * notifyEditSuggestion path can't fire for it. Website submissions set
 * source='web' and are announced by the server action instead; the trigger
 * only fires for source='app' rows, so nothing is ever announced twice.
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

  await tgEditSuggestion({
    suggestionId: record.id,
    targetType: record.target_type ?? "venue",
    targetName: record.target_name ?? null,
    reason: record.reason ?? null,
    details: record.details ?? null,
    contactName: record.contact_name ?? null,
    contactEmail: record.contact_email ?? null,
    isOwner: !!record.is_owner,
    imageUrl: record.image_url ?? null,
  }).catch(() => {});

  return NextResponse.json({ ok: true });
}
