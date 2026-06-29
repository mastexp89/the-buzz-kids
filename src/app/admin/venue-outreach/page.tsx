import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import VenueOutreachClient, { type OutreachRow } from "./VenueOutreachClient";

export const dynamic = "force-dynamic";
export const metadata = { title: "Venue outreach — The Buzz Kids admin" };

export default async function VenueOutreachPage() {
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

  const sb = createServiceClient();
  // Unclaimed venues that DO have a FB URL on file — the cohort worth
  // reaching out to about claiming their Buzz page. Hidden if approved=false
  // *and* unclaimed (those are usually duplicates/dead) — surface only the
  // ones we'd actually want as venue owners.
  const { data: rows } = await sb
    .from("venues")
    .select("id, name, slug, facebook, outreach_messaged_at, approved, city:cities(name, slug)")
    .is("owner_id", null)
    .not("facebook", "is", null)
    .eq("approved", true)
    .order("name");

  const list: OutreachRow[] = (rows ?? []).map((v: any) => ({
    id: v.id,
    name: v.name,
    slug: v.slug,
    facebook: v.facebook,
    cityName: v.city?.name ?? null,
    citySlug: v.city?.slug ?? null,
    messagedAt: v.outreach_messaged_at,
  }));

  return (
    <div className="container-page py-10 max-w-4xl">
      <Link href="/admin" className="text-sm text-buzz-mute hover:text-buzz-accent transition">
        ← Back to admin
      </Link>
      <p className="eyebrow mt-3 mb-1">Admin</p>
      <h1 className="h-display text-4xl sm:text-5xl mb-2">📨 Venue outreach</h1>
      <p className="text-buzz-mute mb-6 max-w-2xl">
        Every venue with a Facebook URL on file but no owner yet — the cohort to
        invite onto The Buzz Guide so they can manage gigs and promotions themselves.
        Click <strong>Open Messenger</strong> to jump straight to a DM with the
        venue&apos;s page, paste the personalised message, and tick the row off when
        you&apos;ve sent it.
      </p>
      <VenueOutreachClient initialRows={list} />
    </div>
  );
}
