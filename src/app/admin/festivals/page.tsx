import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { listFestivals } from "./actions";
import FestivalsListClient from "./FestivalsListClient";

export const dynamic = "force-dynamic";
export const metadata = { title: "Festivals — The Buzz Guide admin" };

export default async function FestivalsAdminPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: me } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (me?.role !== "admin") {
    return (
      <div className="container-page py-16 text-center">
        <h1 className="h-display text-3xl mb-2">Admins only</h1>
        <Link href="/dashboard" className="btn-secondary mt-6 inline-block">Back to dashboard</Link>
      </div>
    );
  }

  const festivals = await listFestivals();

  return (
    <div className="container-page py-10 max-w-5xl">
      <Link href="/admin" className="text-sm text-buzz-mute hover:text-buzz-accent transition">
        ← Back to admin
      </Link>
      <p className="eyebrow mt-3 mb-1">Admin</p>
      <h1 className="h-display text-4xl sm:text-5xl mb-2">🎵 Festivals</h1>
      <p className="text-buzz-mute mb-8 max-w-2xl">
        Multi-venue branded events like Dundee Music Festival. Each festival has
        its own landing page (<code>/festivals/[slug]</code>), a map view, and a
        toggle on the main browse page to filter to its events.
      </p>
      <FestivalsListClient initialFestivals={festivals} />
    </div>
  );
}
