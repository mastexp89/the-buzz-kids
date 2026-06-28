import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getFestivalWithVenues, listFestivalLineup, listFestivalSponsors } from "../actions";
import FestivalDetailClient from "./FestivalDetailClient";

export const dynamic = "force-dynamic";

export default async function FestivalDetailPage({ params }: { params: Promise<{ id: string }> }) {
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
  const [data, lineup, sponsors] = await Promise.all([
    getFestivalWithVenues(id),
    listFestivalLineup(id),
    listFestivalSponsors(id),
  ]);
  if (!data) notFound();

  return (
    <div className="container-page py-10 max-w-5xl">
      <div className="flex justify-between items-center">
        <Link href="/admin/festivals" className="text-sm text-buzz-mute hover:text-buzz-accent transition">
          ← Back to festivals
        </Link>
        <div className="flex gap-2 flex-wrap">
          <Link
            href={`/admin/festivals/${id}/import-lineup`}
            className="btn-secondary text-xs"
          >
            📋 Import lineup
          </Link>
          <Link
            href={`/admin/festivals/${id}/upload-poster`}
            className="btn-secondary text-xs"
          >
            📸 Upload posters
          </Link>
          <Link
            href={`/admin/festivals/${id}/venue-photos`}
            className="btn-secondary text-xs"
          >
            🖼️ Bulk venue photos
          </Link>
        </div>
      </div>
      <FestivalDetailClient
        festival={data.festival}
        venues={data.venues}
        initialLineup={lineup}
        initialSponsors={sponsors}
      />
    </div>
  );
}
