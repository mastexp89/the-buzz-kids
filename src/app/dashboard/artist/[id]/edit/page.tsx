import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import EditArtistClient from "./EditArtistClient";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ id: string }> };

export const metadata = { title: "Edit your artist page — The Buzz Guide" };

export default async function EditArtistPage({ params }: Props) {
  const supabase = await createClient();
  const { id } = await params;

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=/dashboard/artist/${id}/edit`);

  const { data: artist } = await supabase
    .from("artists")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (!artist) notFound();

  // Permission: claimer or admin
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();
  const isAdmin = profile?.role === "admin";
  const isClaimer = artist.claimed_by === user.id;
  if (!isAdmin && !isClaimer) {
    return (
      <div className="container-page py-16 text-center">
        <h1 className="h-display text-3xl mb-2">Not your page</h1>
        <p className="text-buzz-mute mb-6">
          You can only edit an artist page if you've claimed it.
        </p>
        <Link href={`/artists/${artist.slug}`} className="btn-secondary">
          View public page
        </Link>
      </div>
    );
  }

  return (
    <div className="container-page py-10 max-w-3xl">
      <Link
        href={`/artists/${artist.slug}`}
        className="text-sm text-buzz-mute hover:text-buzz-accent transition"
      >
        ← Back to public page
      </Link>
      <p className="eyebrow mt-3 mb-1">Artist dashboard</p>
      <h1 className="h-display text-4xl sm:text-5xl mb-2">Edit {artist.name}</h1>
      <p className="text-buzz-mute mb-4 max-w-xl">
        Anything you change here updates your public artist page right away (once the page is approved).
      </p>

      {/* Approval state banner — same pattern as the venue dashboard. */}
      {!artist.approved ? (
        <div className="card p-4 mb-6 border-buzz-accent/40 bg-buzz-accent/5 text-sm flex items-start gap-3">
          <span className="text-xl">⏳</span>
          <div>
            <div className="font-semibold text-buzz-accent">Awaiting admin approval</div>
            <div className="text-buzz-mute mt-0.5">
              Please continue to edit your bio, photo and socials — your page won't appear publicly until we've approved it. We usually review within 24 hours.
            </div>
          </div>
        </div>
      ) : (
        <div className="card p-3 mb-6 border-emerald-500/30 bg-emerald-500/5 text-sm flex items-start gap-3">
          <span className="text-base">✓</span>
          <div className="flex-1">
            <span className="font-semibold text-emerald-400">Admin approved</span>
            <span className="text-buzz-mute"> — your page is live and your edits go straight to the public page.</span>
          </div>
        </div>
      )}

      <EditArtistClient artist={artist as any} isAdmin={isAdmin} />
    </div>
  );
}
