// Vercel Cron: once each morning, email a single digest IF there's anything
// waiting in the review queue (pending events, edit suggestions, places to
// add). Sends nothing when the queue is empty — no "all clear" noise.
//
// Auth: Vercel sends `Authorization: Bearer ${CRON_SECRET}`. We verify it.
// ?dry=1 to compute counts without sending.

import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { sendAdminEmail } from "@/lib/email";
import { buildEmailHtml, buildEmailText, type EmailBlock } from "@/lib/email-template";

const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.thebuzzkids.co.uk";

export async function GET(req: Request) {
  const auth = req.headers.get("authorization");
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const dry = new URL(req.url).searchParams.get("dry") === "1";
  const sb = createServiceClient();

  async function count(table: string, col: string, filter: (q: any) => any): Promise<number> {
    try {
      const { count } = await filter(sb.from(table).select(col, { count: "exact", head: true }));
      return count ?? 0;
    } catch {
      return 0;
    }
  }

  const events = await count("events", "id", (q) => q.eq("status", "pending"));
  const suggestions = await count("edit_suggestions", "id", (q) => q.eq("status", "new"));
  const places = await count("aggregator_places", "id", (q) => q.eq("status", "new"));
  const total = events + suggestions + places;

  if (total === 0) return NextResponse.json({ ok: true, total, sent: false });
  if (dry) return NextResponse.json({ ok: true, events, suggestions, places, total, sent: false });

  const blocks: EmailBlock[] = [
    { kind: "h", text: "Your review queue" },
    { kind: "p", text: `Morning! You've got ${total} thing${total === 1 ? "" : "s"} waiting to review:` },
    {
      kind: "kv",
      pairs: [
        ["📅 Events to approve", events ? `${events} — /admin/queue` : null],
        ["✏️ Edit suggestions", suggestions ? `${suggestions} — /admin/suggestions` : null],
        ["📍 Places to add", places ? `${places} — /admin/aggregator` : null],
      ],
    },
    { kind: "button", href: `${SITE}/admin`, text: "Open admin" },
    { kind: "small", text: "You only get this when there's something waiting — an empty queue sends nothing." },
  ];

  const ok = await sendAdminEmail({
    subject: `🐝 ${total} waiting to review — The Buzz Kids`,
    html: buildEmailHtml({ preheader: `${events} events, ${suggestions} suggestions, ${places} places`, blocks }),
    text: buildEmailText(blocks),
  });

  return NextResponse.json({ ok, events, suggestions, places, total, sent: ok });
}
