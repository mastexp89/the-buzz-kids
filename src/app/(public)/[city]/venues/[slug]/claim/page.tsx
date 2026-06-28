import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import ClaimForm from "./ClaimForm";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ city: string; slug: string }> };

export async function generateMetadata({ params }: Props) {
  const { slug } = await params;
  return {
    title: `Claim ${slug.replace(/-/g, " ")} — The Buzz Guide`,
    robots: { index: false, follow: false },
  };
}

export default async function ClaimVenuePage({ params }: Props) {
  const supabase = await createClient();
  const { city: citySlug, slug } = await params;

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    redirect(`/login?next=/${citySlug}/venues/${slug}/claim`);
  }

  const { data: venue } = await supabase
    .from("venues")
    .select(`*, city:cities!inner(*)`)
    .eq("slug", slug)
    .single();
  if (!venue) notFound();
  if ((venue.city as any).slug !== citySlug) notFound();
  if (!venue.approved) notFound();

  // If venue already has an owner, send the user to the public page
  if (venue.owner_id) {
    redirect(`/${citySlug}/venues/${slug}`);
  }

  // Check if user already has a pending claim on this venue
  const { data: existingClaim } = await supabase
    .from("venue_claims")
    .select("id, status")
    .eq("venue_id", venue.id)
    .eq("claimant_user_id", user.id)
    .eq("status", "pending")
    .maybeSingle();

  return (
    <div className="container-page py-12 max-w-2xl">
      <Link
        href={`/${citySlug}/venues/${slug}`}
        className="text-sm text-buzz-mute hover:text-buzz-accent transition"
      >
        ← Back to {venue.name}
      </Link>

      <p className="eyebrow mt-4 mb-1">Claim ownership</p>
      <h1 className="h-display text-4xl sm:text-5xl mb-3">
        Take ownership of {venue.name}
      </h1>
      <p className="text-buzz-mute mb-6 max-w-xl">
        This venue page hasn't been claimed yet. If you own, manage or book for{" "}
        {venue.name}, send us a quick claim and we'll set you as the owner so you can
        manage gigs, photos and venue details directly.
      </p>

      {existingClaim ? (
        <div className="card p-6">
          <div className="text-3xl mb-2">⏳</div>
          <h2 className="h-display text-2xl mb-2">Claim already submitted</h2>
          <p className="text-buzz-mute">
            We've got your existing claim and it's waiting for review. We'll email
            you as soon as it's approved (or get in touch if we need more info).
          </p>
        </div>
      ) : (
        <ClaimForm
          venueId={venue.id}
          venueName={venue.name}
          defaultEmail={user.email ?? ""}
        />
      )}
    </div>
  );
}
