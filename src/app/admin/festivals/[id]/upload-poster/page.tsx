import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import PosterUploadClient from "./PosterUploadClient";

export const dynamic = "force-dynamic";
export const metadata = { title: "Upload festival poster — The Buzz Guide admin" };

export default async function FestivalPosterUploadPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: me } = await supabase
    .from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (me?.role !== "admin") notFound();

  const { id } = await params;

  // Service client because the public read policy on events hides
  // unpublished festival rows from authenticated non-admin clients —
  // but the festivals SELECT policy already covers admins for the
  // festival row itself, so this is just being explicit.
  const sb = createServiceClient();
  const { data: festival } = await sb
    .from("festivals")
    .select("id, name, slug, published, start_date, end_date")
    .eq("id", id)
    .maybeSingle();
  if (!festival) notFound();

  return (
    <div className="container-page py-10 max-w-3xl">
      <Link
        href={`/admin/festivals/${festival.id}`}
        className="text-sm text-buzz-mute hover:text-buzz-accent transition"
      >
        ← Back to {festival.name}
      </Link>
      <p className="eyebrow mt-3 mb-1">Festival admin</p>
      <h1 className="h-display text-4xl sm:text-5xl mb-2">📸 Upload posters</h1>
      <p className="text-buzz-mute mb-5 max-w-2xl">
        Drop a poster in, the AI reads the title, date, time, venue and price
        straight off it. Events are added with the festival flag set, which
        means <strong>they stay hidden from the public site until you publish
        the festival</strong>. Venues are matched against the existing
        directory by name — anything that doesn&apos;t match an existing venue
        needs to be picked manually before publish.
      </p>

      {festival.published ? (
        <div className="card p-3 mb-5 text-sm border-amber-500/40 bg-amber-500/5 text-amber-200">
          ⚠ This festival is currently <strong>published</strong> — any events
          you add here will show up on the live site immediately.
        </div>
      ) : (
        <div className="card p-3 mb-5 text-sm border-emerald-500/30 bg-emerald-500/5 text-emerald-300">
          ✓ This festival is currently <strong>unpublished</strong> — events
          added here will stay hidden until you flip the publish toggle on the
          festival page.
        </div>
      )}

      <PosterUploadClient festivalId={festival.id} festivalName={festival.name} />
    </div>
  );
}
