import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import QuickImportClient from "./QuickImportClient";

export const dynamic = "force-dynamic";
export const metadata = { title: "Quick import — The Buzz Guide admin" };

export default async function QuickImportPage() {
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

  return (
    <div className="container-page py-10 max-w-5xl">
      <Link href="/admin" className="text-sm text-buzz-mute hover:text-buzz-accent transition">
        ← Back to admin
      </Link>
      <p className="eyebrow mt-3 mb-1">Admin</p>
      <h1 className="h-display text-4xl sm:text-5xl mb-2">⚡ Quick import</h1>
      <p className="text-buzz-mute mb-8 max-w-2xl">
        Drop in 1–5 posters. Claude reads the venue, date, lineup and details off each one.
        Pick the venue from the dropdown (or add a new one) and confirm the artists, then
        publish — gigs go live straight away and appear on both the venue and artist pages.
      </p>
      <QuickImportClient />
    </div>
  );
}
