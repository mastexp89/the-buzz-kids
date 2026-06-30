import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import QueueClient from "./QueueClient";

export const dynamic = "force-dynamic";

export const metadata = { title: "Approval queue — The Buzz Kids" };

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
    { data: pendingSuggestionsRaw },
    { data: pendingClaimsRaw },
    { data: pendingVenuesRaw },
    { data: pendingOrganisersRaw },
  ] = await Promise.all([
    supabase
      .from("events")
      .select(`
        id, title, start_time, end_time, end_date, recurrence_pattern, recurrence_until,
        description, image_url, submitted_by,
        venue:venues(id, name, slug, city:cities(name, slug))
      `)
      .eq("status", "pending")
      .order("created_at", { ascending: false })
      .limit(200),
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
        reason, created_at, business_name, business_type,
        venue:venues(id, name, slug, owner_id, city:cities(name, slug))
      `)
      .eq("status", "pending")
      .order("created_at", { ascending: false })
      .limit(100),
    // Pending places: approved=false AND owned by a real user (not auto-imported
    // places sitting unclaimed). These are first-time signups awaiting review.
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

  // True pending-events total — the list above is capped (display page size),
  // so the tab count must come from a separate exact count or it sticks at the
  // cap (was showing "100" once the scrape pushed past it).
  const { count: pendingEventsTotal } = await supabase
    .from("events")
    .select("id", { count: "exact", head: true })
    .eq("status", "pending");

  // Look up submitter / claimant profiles separately — events/suggestions/claims reference auth.users,
  // not profiles, so PostgREST can't auto-resolve the relationship.
  const allSubmitterIds = Array.from(new Set([
    ...(pendingEventsRaw ?? []).map((e: any) => e.submitted_by).filter(Boolean),
    ...(pendingSuggestionsRaw ?? []).map((s: any) => s.submitted_by).filter(Boolean),
    ...(pendingClaimsRaw ?? []).map((c: any) => c.claimant_user_id).filter(Boolean),
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
        Pending sessions at listed places are normally approved by the place owner — this queue lets
        you intervene if needed. Venue suggestions and new organiser claims need your review.
      </p>

      <QueueClient
        events={(pendingEvents ?? []) as any}
        eventsTotal={pendingEventsTotal ?? (pendingEvents ?? []).length}
        suggestions={(pendingSuggestions ?? []) as any}
        claims={(pendingClaims ?? []) as any}
        venues={(pendingVenues ?? []) as any}
        organisers={(pendingOrganisers ?? []) as any}
      />
    </div>
  );
}
