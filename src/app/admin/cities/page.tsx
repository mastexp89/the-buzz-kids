import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import CitiesAdminClient from "./CitiesAdminClient";

export const dynamic = "force-dynamic";
export const metadata = { title: "Cities — The Buzz Kids admin" };

export default async function CitiesAdminPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: me } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();
  if (me?.role !== "admin") {
    return (
      <div className="container-page py-16 text-center">
        <h1 className="h-display text-3xl mb-2">Admins only</h1>
        <Link href="/dashboard" className="btn-secondary mt-6 inline-block">Back to dashboard</Link>
      </div>
    );
  }

  const { data: cities } = await supabase
    .from("cities")
    .select("id, name, slug, active, nearby_areas")
    .order("name");

  // Count venues per city so admin sees "is this city even populated?"
  const sb = supabase;
  const { data: venueCounts } = await sb
    .from("venues")
    .select("city_id", { count: "exact" });
  // Group on the client side — the count returned above is the global total,
  // so we need a per-city aggregate. Cheaper to fetch ids only and group.
  const { data: venueIdsByCity } = await sb.from("venues").select("city_id");
  const countByCity = new Map<string, number>();
  for (const v of venueIdsByCity ?? []) {
    if (!v.city_id) continue;
    countByCity.set(v.city_id, (countByCity.get(v.city_id) ?? 0) + 1);
  }

  const rows = (cities ?? []).map((c: any) => ({
    id: c.id,
    name: c.name,
    slug: c.slug,
    active: !!c.active,
    nearbyAreas: Array.isArray(c.nearby_areas) ? c.nearby_areas : [],
    venueCount: countByCity.get(c.id) ?? 0,
  }));

  return (
    <div className="container-page py-10 max-w-4xl">
      <Link href="/admin" className="text-sm text-buzz-mute hover:text-buzz-accent transition">
        ← Back to admin
      </Link>
      <p className="eyebrow mt-3 mb-1">Admin</p>
      <h1 className="h-display text-4xl sm:text-5xl mb-2">🏙️ Cities</h1>
      <p className="text-buzz-mute mb-8 max-w-2xl">
        Toggle a city <strong>active</strong> to publish it on the public site
        (homepage hero, navbar, /city URL). Toggle <strong>inactive</strong> to
        hide it completely — the URL 404s and no copy on the site mentions it.
        Useful for staging a region while you populate venues + events.
      </p>

      <CitiesAdminClient initialCities={rows} />
    </div>
  );
}
