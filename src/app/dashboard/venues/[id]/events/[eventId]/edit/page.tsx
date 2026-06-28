import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import EventForm from "../../EventForm";
import MoveEventPanel from "./MoveEventPanel";
import type { ArtistTag } from "@/components/ArtistTagger";

export const dynamic = "force-dynamic";

export default async function EditEventPage({ params }: { params: Promise<{ id: string; eventId: string }> }) {
  const supabase = await createClient();
  const { id, eventId } = await params;
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  // Admins can edit any gig; owners only their own.
  const { data: me } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  const isAdmin = me?.role === "admin";

  let venueQuery = supabase.from("venues").select("id, name").eq("id", id);
  if (!isAdmin) venueQuery = venueQuery.eq("owner_id", user.id);

  const { data: venue } = await venueQuery.maybeSingle();
  if (!venue) notFound();

  const [{ data: event }, { data: genres }, { data: eg }, { data: ea }] = await Promise.all([
    supabase.from("events").select("*").eq("id", eventId).eq("venue_id", venue.id).maybeSingle(),
    supabase.from("genres").select("*").order("name"),
    supabase.from("event_genres").select("genre_id").eq("event_id", eventId),
    supabase.from("event_artists").select("artist:artists(id, name)").eq("event_id", eventId),
  ]);
  if (!event) notFound();

  const initialArtists: ArtistTag[] = (ea ?? [])
    .map((row: any) => row.artist)
    .filter(Boolean)
    .map((a: any) => ({ kind: "existing" as const, id: a.id, name: a.name }));

  return (
    <div className="flex flex-col gap-4 max-w-3xl">
      <div>
        <Link href={`/dashboard/venues/${venue.id}`} className="text-sm text-buzz-mute hover:text-buzz-accent transition">
          ← Back to {venue.name}
        </Link>
        <p className="eyebrow mt-3 mb-1">Edit gig</p>
        <h1 className="h-display text-4xl">{event.title}</h1>
      </div>
      <EventForm
        mode="edit"
        venueId={venue.id}
        event={event}
        genres={genres ?? []}
        eventGenreIds={(eg ?? []).map((r: any) => r.genre_id)}
        initialArtists={initialArtists}
      />

      {/* Admin-only: re-assign this event to a different venue. Used
          when scraped/imported events landed at the wrong venue.
          Hidden for venue owners — they can only edit gigs that are
          theirs. */}
      {isAdmin && (
        <MoveEventPanel
          eventId={event.id}
          currentVenueId={venue.id}
          currentVenueName={venue.name}
        />
      )}
    </div>
  );
}
