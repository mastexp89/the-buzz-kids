import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import ArtistClaimForm from "./ArtistClaimForm";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props) {
  const { slug } = await params;
  return {
    title: `Claim ${slug.replace(/-/g, " ")} — The Buzz Kids`,
    robots: { index: false, follow: false },
  };
}

export default async function ClaimArtistPage({ params }: Props) {
  const supabase = await createClient();
  const { slug } = await params;

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    redirect(`/login?next=/artists/${slug}/claim`);
  }

  const { data: artist } = await supabase
    .from("artists")
    .select("*")
    .eq("slug", slug)
    .single();
  if (!artist) notFound();
  if (!artist.approved) notFound();

  if (artist.claimed_by) {
    redirect(`/artists/${slug}`);
  }

  const { data: existingClaim } = await supabase
    .from("artist_claims")
    .select("id, status")
    .eq("artist_id", artist.id)
    .eq("claimant_user_id", user.id)
    .eq("status", "pending")
    .maybeSingle();

  return (
    <div className="container-page py-12 max-w-2xl">
      <Link
        href={`/artists/${slug}`}
        className="text-sm text-buzz-mute hover:text-buzz-accent transition"
      >
        ← Back to {artist.name}
      </Link>

      <p className="eyebrow mt-4 mb-1">Claim ownership</p>
      <h1 className="h-display text-4xl sm:text-5xl mb-3">
        Take ownership of {artist.name}
      </h1>
      <p className="text-buzz-mute mb-6 max-w-xl">
        This artist page hasn't been claimed yet. If you are {artist.name} (or manage
        them as a band manager / agent), claim it to upload a profile photo, write
        your bio, link your socials, and have all your gigs auto-show up here.
      </p>

      {existingClaim ? (
        <div className="card p-6">
          <div className="text-3xl mb-2">⏳</div>
          <h2 className="h-display text-2xl mb-2">Claim already submitted</h2>
          <p className="text-buzz-mute">
            We've got your existing claim and it's waiting for review. We'll email
            you as soon as it's approved.
          </p>
        </div>
      ) : (
        <ArtistClaimForm
          artistId={artist.id}
          artistName={artist.name}
          defaultEmail={user.email ?? ""}
        />
      )}
    </div>
  );
}
