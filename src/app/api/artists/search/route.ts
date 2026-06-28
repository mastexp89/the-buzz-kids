import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const q = (url.searchParams.get("q") ?? "").trim();
  if (q.length < 1) return NextResponse.json({ artists: [] });

  const supabase = await createClient();
  const { data } = await supabase
    .from("artists")
    .select("id, name, slug, image_url")
    .ilike("name", `%${q}%`)
    .order("name", { ascending: true })
    .limit(8);

  return NextResponse.json({ artists: data ?? [] });
}
