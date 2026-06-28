import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import ImportLineupClient from "./ImportLineupClient";

export const dynamic = "force-dynamic";
// Claude vision on a busy city-wide programme can take 30-60s and we
// also want headroom for the publish step (one insert per slot × 50+
// slots can be a few seconds even on a quiet Supabase).
export const maxDuration = 180;
export const metadata = { title: "Import lineup — The Buzz Guide admin" };

export default async function ImportLineupPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: me } = await supabase
    .from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (me?.role !== "admin") {
    return (
      <div className="container-page py-16 text-center">
        <h1 className="h-display text-3xl mb-2">Admins only</h1>
        <Link href="/dashboard" className="btn-secondary mt-6 inline-block">
          Back to dashboard
        </Link>
      </div>
    );
  }

  const { id } = await params;
  const sb = createServiceClient();
  const { data: festival } = await sb
    .from("festivals")
    .select("id, name, slug, start_date, end_date")
    .eq("id", id)
    .maybeSingle();
  if (!festival) notFound();

  // Load linked venues for the initial UI — same data the action will
  // refetch on extract, but pre-rendering lets the empty-state message
  // ("link venues first") show before the admin uploads anything.
  const { data: linkedRows } = await sb
    .from("festival_venues")
    .select("venues(id, name, city:cities(name))")
    .eq("festival_id", festival.id);
  const venues = (linkedRows ?? [])
    .map((r: any) => r.venues)
    .filter(Boolean)
    .map((v: any) => ({
      id: v.id as string,
      name: v.name as string,
      city: (v.city?.name as string | null) ?? null,
    }));

  return (
    <div className="container-page py-10 max-w-5xl">
      <Link
        href={`/admin/festivals/${festival.id}`}
        className="text-sm text-buzz-mute hover:text-buzz-accent transition"
      >
        ← Back to {festival.name}
      </Link>
      <p className="eyebrow mt-3 mb-1">Admin · {festival.name}</p>
      <h1 className="h-display text-4xl sm:text-5xl mb-2">📋 Import lineup</h1>
      <p className="text-buzz-mute mb-8 max-w-2xl">
        Upload the festival programme as one or more poster images. Claude
        reads them, matches every act to a participating venue, and you
        review + publish in one go. Saves typing 50+ events one-by-one.
      </p>

      <ImportLineupClient
        festivalId={festival.id}
        festivalSlug={festival.slug}
        festivalName={festival.name}
        venues={venues}
      />
    </div>
  );
}
