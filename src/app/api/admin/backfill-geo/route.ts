// One-shot admin endpoint: geocode any venue with a postcode but no lat/long.
// Run by visiting /api/admin/backfill-geo while signed in as admin.
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { geocodePostcode } from "@/lib/geocode";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const { data: profile } = await supabase
    .from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (profile?.role !== "admin") {
    return NextResponse.json({ error: "Admins only" }, { status: 403 });
  }

  const { data: venues } = await supabase
    .from("venues")
    .select("id, name, postcode, latitude, longitude")
    .not("postcode", "is", null)
    .is("latitude", null);

  let processed = 0;
  let geocoded = 0;
  const failures: Array<{ id: string; name: string; postcode: string }> = [];

  for (const v of venues ?? []) {
    processed++;
    const geo = await geocodePostcode(v.postcode);
    if (geo) {
      await supabase
        .from("venues")
        .update({ latitude: geo.lat, longitude: geo.lng })
        .eq("id", v.id);
      geocoded++;
    } else {
      failures.push({ id: v.id, name: v.name, postcode: v.postcode! });
    }
  }

  return NextResponse.json({ processed, geocoded, failures });
}
