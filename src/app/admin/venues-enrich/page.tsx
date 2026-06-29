import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import VenuesEnrichClient from "./VenuesEnrichClient";

export const dynamic = "force-dynamic";
// Nominatim per-venue fallback can take up to ~33s when there are
// 30 venues to look up (1.1s rate limit each). Default Vercel timeout
// is too low — give the scan headroom.
export const maxDuration = 60;
export const metadata = { title: "Enrich venues — The Buzz Kids admin" };

export default async function VenuesEnrichPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: me } = await supabase
    .from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (me?.role !== "admin") {
    return (
      <div className="container-page py-16 text-center">
        <h1 className="h-display text-3xl mb-2">Admins only</h1>
        <Link href="/dashboard" className="btn-secondary mt-6 inline-block">Back to dashboard</Link>
      </div>
    );
  }

  const [{ data: cities }, { data: festivals }] = await Promise.all([
    supabase
      .from("cities")
      .select("name, slug, active")
      .order("name"),
    supabase
      .from("festivals")
      .select("id, name, slug, start_date, end_date, published")
      .order("start_date", { ascending: true }),
  ]);

  return (
    <div className="container-page py-10 max-w-5xl">
      <Link href="/admin" className="text-sm text-buzz-mute hover:text-buzz-accent transition">
        ← Back to admin
      </Link>
      <p className="eyebrow mt-3 mb-1">Admin</p>
      <h1 className="h-display text-4xl sm:text-5xl mb-2">🌍 Enrich venues</h1>
      <p className="text-buzz-mute mb-8 max-w-2xl">
        Scans <strong>OpenStreetMap</strong> for every venue in the selected
        city or festival and proposes fills for any blank fields (address,
        postcode, lat/long, website, phone). Free, ~3 seconds per region.
        Only fills <strong>missing</strong> data — your manual edits are never
        overwritten. Run, review, tick the fields to apply, save.
      </p>

      <VenuesEnrichClient
        cities={(cities ?? []).map((c) => ({
          slug: c.slug,
          name: c.name,
          active: !!c.active,
        }))}
        festivals={(festivals ?? []).map((f) => ({
          id: f.id,
          name: f.name,
          slug: f.slug,
          startDate: f.start_date,
          endDate: f.end_date,
          published: !!f.published,
        }))}
      />
    </div>
  );
}
