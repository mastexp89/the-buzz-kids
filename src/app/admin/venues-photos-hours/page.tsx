import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import VenuesPhotosHoursClient from "./VenuesPhotosHoursClient";

export const dynamic = "force-dynamic";
// Each Apify run can take up to 45s; we run 3 in parallel per batch and
// the batch action awaits all of them, so worst case is ~50s. Give the
// action room to finish before Vercel cuts it off.
export const maxDuration = 90;
export const metadata = { title: "Photos & opening hours — The Buzz Guide admin" };

export default async function VenuesPhotosHoursPage() {
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

  const { data: cities } = await supabase
    .from("cities")
    .select("name, slug, active")
    .order("name");

  return (
    <div className="container-page py-10 max-w-5xl">
      <Link href="/admin" className="text-sm text-buzz-mute hover:text-buzz-accent transition">
        ← Back to admin
      </Link>
      <p className="eyebrow mt-3 mb-1">Admin</p>
      <h1 className="h-display text-4xl sm:text-5xl mb-2">📸 Photos &amp; opening hours</h1>
      <p className="text-buzz-mute mb-8 max-w-2xl">
        Pulls 6 photos + opening hours from <strong>Google Maps</strong> for
        each venue (via Apify). Only fills in missing data — your manual
        gallery uploads are never overwritten. Pick a city, scan a batch of
        5, review the photos Google found, untick any that don&apos;t fit, save.
      </p>

      <VenuesPhotosHoursClient
        cities={(cities ?? []).map((c) => ({
          slug: c.slug,
          name: c.name,
          active: !!c.active,
        }))}
      />
    </div>
  );
}
