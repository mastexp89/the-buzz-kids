import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import EventForm from "../EventForm";

export const dynamic = "force-dynamic";

export default async function NewEventPage({ params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient();
  const { id } = await params;
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  // Admins can add gigs to any venue; owners only their own.
  const { data: me } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  const isAdmin = me?.role === "admin";

  let venueQuery = supabase.from("venues").select("*").eq("id", id);
  if (!isAdmin) venueQuery = venueQuery.eq("owner_id", user.id);

  const [{ data: venue }, { data: genres }] = await Promise.all([
    venueQuery.maybeSingle(),
    supabase.from("genres").select("*").order("name"),
  ]);

  if (!venue) notFound();

  return (
    <div className="flex flex-col gap-4 max-w-3xl">
      <div>
        <Link href={`/dashboard/venues/${venue.id}`} className="text-sm text-buzz-mute hover:text-buzz-accent transition">
          ← Back to {venue.name}
        </Link>
        <p className="eyebrow mt-3 mb-1">Add an event</p>
        <h1 className="h-display text-4xl">{venue.name}</h1>
      </div>
      <EventForm
        mode="create"
        venueId={venue.id}
        event={null}
        genres={genres ?? []}
        eventGenreIds={[]}
      />
    </div>
  );
}
