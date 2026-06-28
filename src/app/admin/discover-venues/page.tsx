import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import DiscoverVenuesClient from "./DiscoverVenuesClient";

export const dynamic = "force-dynamic";
export const metadata = { title: "Discover places — The Buzz Kids admin" };

export default async function DiscoverVenuesPage() {
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

  // Show ALL cities, not just active ones — admins need to populate
  // venues before flipping a city live.
  const { data: cities } = await supabase
    .from("cities")
    .select("id, name, slug, active, nearby_areas")
    .order("name");

  return (
    <div className="container-page py-10 max-w-5xl">
      <Link href="/admin" className="text-sm text-buzz-mute hover:text-buzz-accent transition">
        ← Back to admin
      </Link>
      <p className="eyebrow mt-3 mb-1">Admin</p>
      <h1 className="h-display text-4xl sm:text-5xl mb-2">🗺️ Discover places</h1>
      <p className="text-buzz-mute mb-8 max-w-2xl">
        Auto-fills a region's places from <strong>OpenStreetMap</strong> (free,
        no usage limits, strictly bounded by town boundary). Pick a city,
        click <strong>Discover</strong>, review what comes back, tick the ones
        that look right, and bulk-create the lot. Each new place lands as
        approved with whatever OSM has on it — name + lat/lng always, plus
        address / website / phone where the OSM mappers have filled them in.
        Anything missing fills itself in later via the Place FB URLs tool's
        website-scrape step.
      </p>

      <DiscoverVenuesClient
        cities={(cities ?? []).map((c: any) => ({
          slug: c.slug,
          name: c.name,
          active: !!c.active,
          nearbyAreas: Array.isArray(c.nearby_areas) ? c.nearby_areas : [],
        }))}
      />
    </div>
  );
}
