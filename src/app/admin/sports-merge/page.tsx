import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { findSportsClusters } from "./actions";
import SportsMergeClient from "./SportsMergeClient";

export const dynamic = "force-dynamic";
export const metadata = { title: "Merge legacy sports events — The Buzz Guide admin" };

export default async function SportsMergePage() {
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

  const preview = await findSportsClusters();
  const clusters = "ok" in preview ? preview.clusters : [];
  const totalEvents = clusters.reduce((sum, c) => sum + c.count, 0);

  return (
    <div className="container-page py-10 max-w-4xl">
      <Link href="/admin" className="text-sm text-buzz-mute hover:text-buzz-accent transition">
        ← Back to admin
      </Link>
      <p className="eyebrow mt-3 mb-1">Admin</p>
      <h1 className="h-display text-4xl sm:text-5xl mb-2">🏟️ Merge legacy sports</h1>
      <p className="text-buzz-mute mb-6 max-w-2xl">
        Old FB-imported sports screenings that were inserted before the
        same-day aggregation rule landed — each one is currently its own
        event row. Merging consolidates each cluster into a single
        &quot;Live sports — N matches&quot; event with the fixtures listed in the
        description. Only touches AI-imported events tagged with the
        sports genre — manually-created events are never touched.
      </p>
      <SportsMergeClient
        initialClusters={clusters}
        totalEventsAcrossClusters={totalEvents}
      />
    </div>
  );
}
