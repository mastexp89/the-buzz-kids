import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import QueueClient from "./QueueClient";

export const dynamic = "force-dynamic";

export const metadata = { title: "Approval queue — The Buzz Guide" };

export default async function AdminQueuePage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: me } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  if (me?.role !== "admin") {
    return (
      <div className="container-page py-16 text-center">
        <h1 className="h-display text-3xl mb-2">Admins only</h1>
        <Link href="/dashboard" className="btn-secondary mt-6 inline-block">Back to dashboard</Link>
      </div>
    );
  }

  const [
    { data: pendingEventsRaw },
    { data: pendingArtists },
    { data: pendingSuggestionsRaw },
    { data: pendingClaimsRaw },
    { data: pendingVenuesRaw },
    { data: pendingOrganisersRaw },
  ] = await Promise.all([
    supabase
      .from("events")
      .select(`
        id, title, start_time, description, image_url, submitted_by,
        venue:venues(id, name, slug, city:cities(name, slug))
      `)
      .eq("status", "pending")
      .order("created_at", { ascending: false })
      .limit(100),
    supabase
      .from("artists")
      .select("id, name, slug, image_url, created_at, claimed_by")
      .eq("approved", false)
      .order("created_at", { ascending: false })
      .limit(100),
    supabase
      .from("venue_suggestions")
      .select(`
        id, venue_name, address, postcode, website, submitted_by,
        gig_title, gig_start_time, submitter_name, submitter_contact, created_at,
        city:cities(name, slug)
      `)
      .eq("status", "pending")
      .order("created_at", { ascending: false })
      .limit(100),
    supabase
      .from("venue_claims")
      .select(`
        id, venue_id, claimant_user_id, role, contact_phone, contact_email,
        reason, created_at,
        venue:venues(id, name, slug, owner_id, city:cities(name, slug))
      `)
      .eq("status", "pending")
      .order("created_at", { ascending: false })
      .limit(100),
    // Pending venues: approved=false AND owned by a real user (not auto-imported
    // pubs sitting unclaimed). These are first-time venue signups awaiting review.
    supabase
      .from("venues")
      .select("id, name, slug, address, postcode, owner_id, created_at, city:cities(name, slug)")
      .eq("approved", false)
      .not("owner_id", "is", null)
      .order("created_at", { ascending: false })
      .limit(100),
    // Pending organisers: approved=false AND claimed (so we don't list
    // unclaimed scaffolds, only ones a real user is waiting on).
    supabase
      .from("organisers")
      .select("id, name, slug, bio, image_url, claimed_by, created_at")
      .eq("approved", false)
      .not("claimed_by", "is", null)
      .order("created_at", { ascending: false })
      .limit(100),
  ]);

  const { data: pendingArtistClaimsRaw } = await supabase
    .from("artist_claims")
    .select(`
      id, artist_id, claimant_user_id, role, contact_phone, contact_email,
      reason, created_at,
      artist:artists(id, name, slug, claimed_by, image_url)
    `)
    .eq("status", "pending")
    .order("created_at", { ascending: false })
    .limit(100);

  // Look up submitter / claimant profiles separately — events/suggestions/claims reference auth.users,
  // not profiles, so PostgREST can't auto-resolve the relationship.
  const allSubmitterIds = Array.from(new Set([
    ...(pendingEventsRaw ?? []).map((e: any) => e.submitted_by).filter(Boolean),
    ...(pendingSuggestionsRaw ?? []).map((s: any) => s.submitted_by).filter(Boolean),
    ...(pendingClaimsRaw ?? []).map((c: any) => c.claimant_user_id).filter(Boolean),
    ...(pendingArtistClaimsRaw ?? []).map((c: any) => c.claimant_user_id).filter(Boolean),
    ...(pendingVenuesRaw ?? []).map((v: any) => v.owner_id).filter(Boolean),
    ...(pendingOrganisersRaw ?? []).map((o: any) => o.claimed_by).filter(Boolean),
  ]));
  const submitterMap = new Map<string, { email: string | null; display_name: string | null }>();
  if (allSubmitterIds.length > 0) {
    const { data: subs } = await supabase
      .from("profiles")
      .select("id, email, display_name")
      .in("id", allSubmitterIds);
    for (const s of subs ?? []) {
      submitterMap.set(s.id, { email: s.email, display_name: s.display_name });
    }
  }
  const pendingEvents = (pendingEventsRaw ?? []).map((e: any) => ({
    ...e,
    submitter: e.submitted_by ? submitterMap.get(e.submitted_by) ?? null : null,
  }));
  const pendingSuggestions = (pendingSuggestionsRaw ?? []).map((s: any) => ({
    ...s,
    submitter: s.submitted_by ? submitterMap.get(s.submitted_by) ?? null : null,
  }));
  const pendingClaims = (pendingClaimsRaw ?? []).map((c: any) => ({
    ...c,
    claimant: c.claimant_user_id ? submitterMap.get(c.claimant_user_id) ?? null : null,
  }));
  const pendingArtistClaims = (pendingArtistClaimsRaw ?? []).map((c: any) => ({
    ...c,
    claimant: c.claimant_user_id ? submitterMap.get(c.claimant_user_id) ?? null : null,
  }));
  const pendingVenues = (pendingVenuesRaw ?? []).map((v: any) => ({
    ...v,
    owner: v.owner_id ? submitterMap.get(v.owner_id) ?? null : null,
  }));
  const pendingOrganisers = (pendingOrganisersRaw ?? []).map((o: any) => ({
    ...o,
    claimer: o.claimed_by ? submitterMap.get(o.claimed_by) ?? null : null,
  }));

  return (
    <div className="container-page py-10 max-w-5xl">
      <Link href="/admin" className="text-sm text-buzz-mute hover:text-buzz-accent transition">
        ← Back to admin
      </Link>
      <p className="eyebrow mt-3 mb-1">Admin</p>
      <h1 className="h-display text-4xl sm:text-5xl mb-2">Approval queue</h1>
      <p className="text-buzz-mute mb-8 max-w-2xl">
        Pending gigs at listed venues are normally approved by the venue owner — this queue lets
        you intervene if needed. New artists and venue suggestions need your review.
      </p>

      <QueueClient
        events={(pendingEvents ?? []) as any}
        artists={(pendingArtists ?? []) as any}
        suggestions={(pendingSuggestions ?? []) as any}
        claims={(pendingClaims ?? []) as any}
        artistClaims={(pendingArtistClaims ?? []) as any}
        venues={(pendingVenues ?? []) as any}
        organisers={(pendingOrganisers ?? []) as any}
      />
    </div>
  );
}
