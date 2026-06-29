import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import VenuesManageClient from "./VenuesManageClient";

export const dynamic = "force-dynamic";
export const metadata = { title: "Manage places — The Buzz Kids admin" };

export default async function VenuesManagePage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/admin/venues-manage");
  const { data: me } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (me?.role !== "admin") {
    return (
      <div className="container-page py-16 text-center">
        <h1 className="h-display text-3xl mb-2">Admins only</h1>
        <Link href="/admin" className="btn-secondary mt-6 inline-block">Back to admin</Link>
      </div>
    );
  }

  const [{ data: venues }, { data: cities }] = await Promise.all([
    supabase
      .from("venues")
      .select(`
        id, name, slug, description, address, postcode, phone, website,
        image_url, cover_photo_url, logo_url, gallery_image_urls, google_photo_url,
        is_free, price_from, age_min, age_max, setting, venue_type,
        approved, auto_imported, owner_id, created_at,
        city:cities(name, slug),
        venue_genres ( genre:genres ( name, slug ) )
      `)
      .order("name"),
    supabase.from("cities").select("name, slug, active").order("name"),
  ]);

  const rows = (venues ?? []).map((v: any) => ({
    ...v,
    categories: (v.venue_genres ?? []).map((vg: any) => vg.genre).filter(Boolean),
  }));

  return (
    <div className="container-page py-10 max-w-6xl">
      <Link href="/admin" className="text-sm text-buzz-mute hover:text-buzz-accent transition">← Back to admin</Link>
      <p className="eyebrow mt-4 mb-1">Directory</p>
      <h1 className="h-display text-4xl sm:text-5xl mb-2">Manage places</h1>
      <p className="text-buzz-mute mb-6 max-w-xl">
        Every place in the directory — photo, description, phone and website at a glance.
        Edit or delete any of them. Filter by area or search by name.
      </p>
      <VenuesManageClient venues={rows} cities={cities ?? []} />
    </div>
  );
}
