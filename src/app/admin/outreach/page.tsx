import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import OutreachClient from "./OutreachClient";

export const dynamic = "force-dynamic";

export default async function OutreachPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: me } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  if (me?.role !== "admin") {
    return (
      <div className="container-page py-16 text-center">
        <h1 className="h-display text-3xl mb-2">Admins only</h1>
        <Link href="/dashboard" className="btn-secondary mt-6 inline-block">Back</Link>
      </div>
    );
  }

  const [{ data: prospects }, { data: cities }] = await Promise.all([
    supabase
      .from("prospects")
      .select("*")
      .order("status", { ascending: true })
      .order("name", { ascending: true }),
    supabase.from("cities").select("id, name, slug").order("name"),
  ]);

  return (
    <div className="container-page py-10 max-w-6xl">
      <Link href="/admin" className="text-sm text-buzz-mute hover:text-buzz-accent transition">
        ← Back to admin
      </Link>
      <p className="eyebrow mt-3 mb-1">Outreach</p>
      <h1 className="h-display text-4xl sm:text-5xl mb-2">Venue tracker</h1>
      <p className="text-buzz-mute mb-8 max-w-2xl">
        Every bar, pub, club and venue we want on The Buzz Guide. Mark them contacted, log notes,
        and update their status as you work through the list.
      </p>

      <OutreachClient
        initialProspects={(prospects ?? []) as any}
        cities={(cities ?? []) as any}
      />
    </div>
  );
}
