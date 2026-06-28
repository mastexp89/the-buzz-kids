import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import VenuesDedupeClient from "./VenuesDedupeClient";

export const dynamic = "force-dynamic";
export const metadata = { title: "Dedupe venues — The Buzz Guide admin" };

export default async function VenuesDedupePage() {
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

  // All cities (active + hidden) so admin can dedupe Angus while it's not yet live.
  const { data: cities } = await supabase
    .from("cities").select("name, slug, active").order("name");

  return (
    <div className="container-page py-10 max-w-5xl">
      <Link href="/admin" className="text-sm text-buzz-mute hover:text-buzz-accent transition">
        ← Back to admin
      </Link>
      <p className="eyebrow mt-3 mb-1">Admin</p>
      <h1 className="h-display text-4xl sm:text-5xl mb-2">🧹 Dedupe venues</h1>
      <p className="text-buzz-mute mb-8 max-w-2xl">
        Finds venues with the same normalised name (case + "the" prefix +
        punctuation all ignored). Pick the keeper in each group, click
        <strong> Merge</strong>, and we'll move every event / extraction /
        page-view / festival link onto the keeper, drop redundant claims,
        and 301 the loser slugs to the keeper. Safe — nothing is deleted
        without your click.
      </p>

      <VenuesDedupeClient
        cities={(cities ?? []).map((c: any) => ({
          slug: c.slug,
          name: c.name,
          active: !!c.active,
        }))}
      />
    </div>
  );
}
