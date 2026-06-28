import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { findPlacePhoto, venueSearchQuery } from "@/lib/google-places";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

// Populate google_place_id + google_photo_url for browsable places that don't
// have a Google photo yet. Auth: requires CRON_SECRET in production; open in
// local dev so it's easy to trigger while building.
export async function POST(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const provided =
    req.nextUrl.searchParams.get("secret") ||
    req.headers.get("authorization")?.replace("Bearer ", "");
  const isProd = process.env.NODE_ENV === "production";
  if (isProd && (!secret || provided !== secret)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const supabase = createServiceClient();
  const limit = Number(req.nextUrl.searchParams.get("limit") || 25);

  const { data: venues, error } = await supabase
    .from("venues")
    .select("id, name, address, postcode, city:cities(name)")
    .in("venue_type", ["attraction", "both"])
    .is("google_photo_url", null)
    .limit(limit);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const results: Array<{ name: string; ok: boolean; photo?: boolean; reason?: string }> = [];
  for (const v of venues ?? []) {
    try {
      const found = await findPlacePhoto(
        venueSearchQuery({
          name: (v as any).name,
          address: (v as any).address,
          postcode: (v as any).postcode,
          cityName: (v as any).city?.name,
        }),
      );
      if (found) {
        await supabase
          .from("venues")
          .update({
            google_place_id: found.placeId,
            google_photo_url: found.photoUrl,
            google_photo_attribution: found.attribution,
            google_synced_at: new Date().toISOString(),
          })
          .eq("id", (v as any).id);
        results.push({ name: (v as any).name, ok: true, photo: !!found.photoUrl });
      } else {
        results.push({ name: (v as any).name, ok: false, reason: "no Google match" });
      }
    } catch (e: any) {
      results.push({ name: (v as any).name, ok: false, reason: String(e?.message).slice(0, 120) });
    }
  }

  return NextResponse.json({ processed: results.length, results });
}
