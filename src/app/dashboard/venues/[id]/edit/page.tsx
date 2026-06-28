import { notFound } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import VenueForm from "../../VenueForm";
import AdminEventsPanel from "./AdminEventsPanel";

export const dynamic = "force-dynamic";

export default async function EditVenuePage({ params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient();
  const { id } = await params;
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const [{ data: me }, { data: venue }, { data: cities }, { data: genres }] = await Promise.all([
    supabase.from("profiles").select("role").eq("id", user.id).maybeSingle(),
    supabase.from("venues").select("*").eq("id", id).maybeSingle(),
    supabase.from("cities").select("*").eq("active", true).order("name"),
    supabase.from("genres").select("*").order("name"),
  ]);

  if (!venue) notFound();
  const isAdmin = me?.role === "admin";
  if (venue.owner_id !== user.id && !isAdmin) notFound();

  const { data: vgRows } = await supabase.from("venue_genres").select("genre:genres(slug)").eq("venue_id", venue.id);
  const currentCategories = (vgRows ?? []).map((r: any) => r.genre?.slug).filter(Boolean);

  // Admin-only: load every event at this venue so the side panel can show
  // a delete button per row. Skip the fetch entirely for non-admins.
  let venueEvents: any[] = [];
  if (isAdmin) {
    const { data: evs } = await supabase
      .from("events")
      .select("id, title, start_time, status, auto_imported_from")
      .eq("venue_id", venue.id)
      .order("start_time", { ascending: false })
      .limit(200);
    venueEvents = evs ?? [];
  }

  const header = (
    <div>
      <Link
        href={isAdmin && venue.owner_id !== user.id ? "/admin" : `/dashboard/venues/${venue.id}`}
        className="text-sm text-buzz-mute hover:text-buzz-accent transition"
      >
        ← Back
      </Link>
      <p className="eyebrow mt-3 mb-1">
        {isAdmin && venue.owner_id !== user.id ? "Admin · Edit venue" : "Edit venue"}
      </p>
      <h1 className="h-display text-4xl">{venue.name}</h1>
    </div>
  );

  if (!isAdmin) {
    return (
      <div className="flex flex-col gap-6 max-w-3xl">
        {header}
        <VenueForm venue={venue} cities={cities ?? []} categories={genres ?? []} currentCategories={currentCategories} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {header}
      <div className="grid lg:grid-cols-[300px_1fr] gap-6 items-start">
        <AdminEventsPanel venueId={venue.id} events={venueEvents} />
        <div className="max-w-3xl">
          <VenueForm venue={venue} cities={cities ?? []} categories={genres ?? []} currentCategories={currentCategories} isAdmin={isAdmin} />
        </div>
      </div>
    </div>
  );
}
