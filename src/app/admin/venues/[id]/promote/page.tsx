import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import AdminPromoteClient from "./AdminPromoteClient";

export const dynamic = "force-dynamic";

export default async function AdminPromotePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: me } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();
  if (me?.role !== "admin") {
    return (
      <div className="container-page py-16 text-center">
        <h1 className="h-display text-3xl mb-2">Admins only</h1>
        <p className="text-buzz-mute">Your account isn't an admin.</p>
        <Link href="/dashboard" className="btn-secondary mt-6 inline-block">
          Back to dashboard
        </Link>
      </div>
    );
  }

  const { id } = await params;

  const { data: venue } = await supabase
    .from("venues")
    .select("*, city:cities(*), owner:profiles!owner_id(email, display_name)")
    .eq("id", id)
    .maybeSingle();
  if (!venue) notFound();

  const now = new Date().toISOString();
  const { data: events } = await supabase
    .from("events")
    .select(
      "id, title, start_time, featured_until, highlighted_until, genre_takeover_until, weekend_boost_until",
    )
    .eq("venue_id", venue.id)
    .gte("start_time", now)
    .eq("cancelled", false)
    .order("start_time", { ascending: true });

  return (
    <div className="container-page py-10 max-w-3xl flex flex-col gap-6">
      <div>
        <Link
          href="/admin"
          className="text-sm text-buzz-mute hover:text-buzz-accent transition"
        >
          ← Back to admin
        </Link>
        <p className="eyebrow mt-3 mb-1">Admin · Promote</p>
        <h1 className="h-display text-4xl">Comp promotions for {venue.name}.</h1>
        <p className="text-buzz-mute mt-2">
          Grant or cancel any promotion for this venue without charging Stripe.
          Set a custom duration in days, then activate.
        </p>
        {venue.owner?.email && (
          <p className="text-xs text-buzz-mute mt-2">
            Owner: {venue.owner.email}
          </p>
        )}
      </div>

      <AdminPromoteClient venue={venue as any} events={events ?? []} />
    </div>
  );
}
