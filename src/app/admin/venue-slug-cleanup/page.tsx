import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { findSuffixedVenues } from "./actions";
import SlugCleanupClient from "./SlugCleanupClient";

export const dynamic = "force-dynamic";
export const metadata = { title: "Clean up venue slugs — The Buzz Guide admin" };

export default async function VenueSlugCleanupPage() {
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

  const res = await findSuffixedVenues();
  const venues = "ok" in res ? res.venues : [];

  return (
    <div className="container-page py-10 max-w-4xl">
      <Link href="/admin" className="text-sm text-buzz-mute hover:text-buzz-accent transition">
        ← Back to admin
      </Link>
      <p className="eyebrow mt-3 mb-1">Admin</p>
      <h1 className="h-display text-4xl sm:text-5xl mb-2">🧼 Venue slug cleanup</h1>
      <p className="text-buzz-mute mb-6 max-w-2xl">
        Venues whose URLs got stamped with a random 6-character suffix
        (e.g. <code>the-gunners-bar-isx3pa</code>) by an old import script.
        Stripping the suffix where it&apos;s safe; falling back to clean
        <code>-2</code> / <code>-3</code> increments when another venue
        actually owns the base name. Every rename adds a{" "}
        <code>slug_redirect</code> automatically so old links still resolve.
      </p>
      <SlugCleanupClient initialVenues={venues} />
    </div>
  );
}
