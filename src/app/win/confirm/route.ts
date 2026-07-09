import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";

// Double opt-in landing: the confirm link in the email points here.
export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token");
  const base = process.env.NEXT_PUBLIC_SITE_URL ?? req.nextUrl.origin;

  if (!token) return NextResponse.redirect(`${base}/win`);

  const sb = createServiceClient();
  const { data: row } = await sb
    .from("notify_signups").select("email, confirmed").eq("confirm_token", token).maybeSingle();

  if (!row) return NextResponse.redirect(`${base}/win`);

  if (!row.confirmed) {
    await sb
      .from("notify_signups")
      .update({ confirmed: true, confirmed_at: new Date().toISOString() })
      .eq("confirm_token", token);
  }

  return NextResponse.redirect(`${base}/win?confirmed=1`);
}
