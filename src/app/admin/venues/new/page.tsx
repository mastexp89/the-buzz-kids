import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { canContribute } from "@/lib/roles";
import NewVenueForm from "./NewVenueForm";

export const dynamic = "force-dynamic";
export const metadata = { title: "Add venue — The Buzz Kids admin" };

export default async function NewVenuePage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: me } = await supabase
    .from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (!canContribute(me?.role)) {
    return (
      <div className="container-page py-16 text-center">
        <h1 className="h-display text-3xl mb-2">Staff only</h1>
        <Link href="/dashboard" className="btn-secondary mt-6 inline-block">Back to dashboard</Link>
      </div>
    );
  }

  // Cities for the dropdown — include hidden ones so admin can seed a
  // new region before it goes public.
  const { data: cities } = await supabase
    .from("cities")
    .select("id, name, slug, active")
    .order("name");

  return (
    <div className="container-page py-10 max-w-2xl">
      <Link href="/admin" className="text-sm text-buzz-mute hover:text-buzz-accent transition">
        ← Back to admin
      </Link>
      <p className="eyebrow mt-3 mb-1">Admin</p>
      <h1 className="h-display text-4xl sm:text-5xl mb-2">➕ Add venue</h1>
      <p className="text-buzz-mute mb-6 max-w-xl">
        Manually create a venue when it&apos;s not in Google Maps / OSM and
        nobody&apos;s suggested it yet. The venue is pre-approved (no queue
        trip) and appears on its city page immediately.
      </p>
      <NewVenueForm
        cities={(cities ?? []).map((c: any) => ({
          id: c.id,
          name: c.name,
          slug: c.slug,
          active: !!c.active,
        }))}
      />
    </div>
  );
}
