import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import PasteFixturesClient from "./PasteFixturesClient";

export const dynamic = "force-dynamic";

export default async function PasteFixturesPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const supabase = await createClient();
  const { id } = await params;
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: me } = await supabase
    .from("profiles").select("role").eq("id", user.id).maybeSingle();
  const isAdmin = me?.role === "admin";

  let venueQuery = supabase.from("venues").select("*").eq("id", id);
  if (!isAdmin) venueQuery = venueQuery.eq("owner_id", user.id);
  const { data: venue } = await venueQuery.maybeSingle();
  if (!venue) notFound();

  return (
    <div className="flex flex-col gap-4 max-w-3xl">
      <div>
        <Link
          href={`/dashboard/venues/${venue.id}`}
          className="text-sm text-buzz-mute hover:text-buzz-accent transition"
        >
          ← Back to {venue.name}
        </Link>
        <p className="eyebrow mt-3 mb-1">Paste fixtures</p>
        <h1 className="h-display text-4xl">{venue.name}</h1>
        <p className="text-buzz-mute mt-3 max-w-2xl text-sm">
          Paste in your sports fixtures (or any text-only list of events). The
          AI groups multiple matches per day into a single &quot;Live sports&quot; card,
          so your customers see one tidy row per day instead of a dozen
          redundant ones. Review the suggestions, untick anything wrong, then
          create them all in one go.
        </p>
      </div>
      <PasteFixturesClient venueId={venue.id} />
    </div>
  );
}
