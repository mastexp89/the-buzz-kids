import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { listFestivalVenuePhotos } from "./actions";
import VenuePhotosClient from "./VenuePhotosClient";

export const dynamic = "force-dynamic";
export const metadata = { title: "Venue photos — The Buzz Guide admin" };

export default async function VenuePhotosPage({ params }: { params: Promise<{ id: string }> }) {
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

  const { id } = await params;
  const sb = createServiceClient();
  const { data: festival } = await sb.from("festivals").select("id, name, slug").eq("id", id).maybeSingle();
  if (!festival) notFound();

  const venues = await listFestivalVenuePhotos(id);

  return (
    <div className="container-page py-10 max-w-5xl">
      <Link href={`/admin/festivals/${id}`} className="text-sm text-buzz-mute hover:text-buzz-accent transition">
        ← Back to {festival.name}
      </Link>
      <p className="eyebrow mt-3 mb-1">Admin · {festival.name}</p>
      <h1 className="h-display text-4xl sm:text-5xl mb-2">📸 Venue cover photos</h1>
      <p className="text-buzz-mute mb-8 max-w-2xl">
        Paste an image URL for each venue (right-click their FB profile picture → "Copy image
        address" works well). We download it, save it to our storage bucket, and set it as
        the venue's cover photo. Hit Enter or click "Use URL" to save each row.
      </p>
      <VenuePhotosClient festivalId={id} initialVenues={venues} />
    </div>
  );
}
