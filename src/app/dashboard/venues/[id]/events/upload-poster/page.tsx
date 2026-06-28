import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import PosterReviewPanel from "@/components/PosterReviewPanel";

export const dynamic = "force-dynamic";

export default async function UploadPosterPage({ params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient();
  const { id } = await params;
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: me } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  const isAdmin = me?.role === "admin";

  let q = supabase.from("venues").select("*").eq("id", id);
  if (!isAdmin) q = q.eq("owner_id", user.id);
  const { data: venue } = await q.maybeSingle();
  if (!venue) notFound();

  return (
    <div className="flex flex-col gap-4 max-w-4xl">
      <div>
        <Link href={`/dashboard/venues/${venue.id}`} className="text-sm text-buzz-mute hover:text-buzz-accent transition">
          ← Back to {venue.name}
        </Link>
        <p className="eyebrow mt-3 mb-1">Upload posters</p>
        <h1 className="h-display text-4xl">{venue.name}</h1>
      </div>
      <PosterReviewPanel venueId={venue.id} venueName={venue.name} />
    </div>
  );
}
