import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import PromoteClient from "./PromoteClient";

export const dynamic = "force-dynamic";

export default async function PromotePage({ params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient();
  const { id } = await params;
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: venue } = await supabase
    .from("venues")
    .select("*")
    .eq("id", id)
    .eq("owner_id", user.id)
    .maybeSingle();
  if (!venue) notFound();

  const now = new Date().toISOString();
  const { data: events } = await supabase
    .from("events")
    .select("id, title, start_time, featured_until, highlighted_until, genre_takeover_until, weekend_boost_until")
    .eq("venue_id", venue.id)
    .gte("start_time", now)
    .eq("cancelled", false)
    .order("start_time", { ascending: true });

  return (
    <div className="flex flex-col gap-6 max-w-3xl">
      <div>
        <Link href={`/dashboard/venues/${venue.id}`} className="text-sm text-buzz-mute hover:text-buzz-accent transition">
          ← Back to {venue.name}
        </Link>
        <p className="eyebrow mt-3 mb-1">Promote</p>
        <h1 className="h-display text-4xl">Boost {venue.name}.</h1>
        <p className="text-buzz-mute mt-2">
          Free during launch. Just activate any of these to give your gigs and venue a leg up — toggle them off any time.
        </p>
      </div>

      <PromoteClient venue={venue as any} events={events ?? []} />
    </div>
  );
}
