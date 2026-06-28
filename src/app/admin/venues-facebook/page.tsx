import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import VenuesFacebookEditor from "./VenuesFacebookEditor";

export const dynamic = "force-dynamic";
export const metadata = { title: "Venue Facebook URLs — The Buzz Guide admin" };

type Row = {
  id: string;
  name: string;
  slug: string;
  facebook: string | null;
  website: string | null;
  approved: boolean;
  citySlug: string | null;
  cityName: string | null;
  lastScrape: string | null;
};

export default async function VenuesFacebookPage() {
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

  const { data: venues } = await supabase
    .from("venues")
    .select("id, name, slug, facebook, website, approved, last_facebook_scrape, city:cities(name, slug)")
    .order("name");

  const rows: Row[] = (venues ?? []).map((v: any) => ({
    id: v.id,
    name: v.name,
    slug: v.slug,
    facebook: v.facebook ?? null,
    website: v.website ?? null,
    approved: !!v.approved,
    citySlug: v.city?.slug ?? null,
    cityName: v.city?.name ?? null,
    lastScrape: v.last_facebook_scrape ?? null,
  }));

  // Missing FB first, then alphabetical (the order data was already in).
  rows.sort((a, b) => {
    const aMissing = !a.facebook;
    const bMissing = !b.facebook;
    if (aMissing !== bMissing) return aMissing ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  const totalCount = rows.length;
  const withFb = rows.filter((r) => !!r.facebook).length;
  const withoutFb = totalCount - withFb;

  return (
    <div className="container-page py-10 max-w-5xl">
      <Link href="/admin" className="text-sm text-buzz-mute hover:text-buzz-accent transition">
        ← Back to admin
      </Link>
      <p className="eyebrow mt-3 mb-1">Admin</p>
      <h1 className="h-display text-4xl sm:text-5xl mb-2">📘 Venue Facebook URLs</h1>
      <p className="text-buzz-mute mb-6 max-w-2xl">
        Paste each venue's Facebook page URL so the cron scraper can pull their posts. Venues
        without a Facebook URL won't get auto-imported events. Edits save the moment you click
        away from the input.
      </p>

      <div className="card p-4 mb-6 flex flex-wrap gap-4 text-sm">
        <span><strong className="text-buzz-accent">{withFb}</strong> have URL</span>
        <span className="text-buzz-mute">·</span>
        <span><strong className="text-orange-400">{withoutFb}</strong> missing</span>
        <span className="text-buzz-mute">·</span>
        <span>{totalCount} total</span>
      </div>

      <VenuesFacebookEditor initialRows={rows} />
    </div>
  );
}
