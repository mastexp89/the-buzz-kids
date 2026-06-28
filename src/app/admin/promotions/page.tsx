import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import PromotionsOverviewClient from "./PromotionsOverviewClient";

export const dynamic = "force-dynamic";

export default async function AdminPromotionsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: me } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();
  if (me?.role !== "admin") {
    return (
      <div className="container-page py-16 text-center">
        <h1 className="h-display text-3xl mb-2">Admins only</h1>
        <p className="text-buzz-mute">Your account isn't an admin.</p>
        <Link href="/dashboard" className="btn-secondary mt-6 inline-block">
          Back to dashboard
        </Link>
      </div>
    );
  }

  const nowDate = new Date();
  const now = nowDate.toISOString();
  const sevenDaysAgo = new Date(
    nowDate.getTime() - 7 * 24 * 60 * 60 * 1000,
  ).toISOString();

  const [
    { data: spotlightVenues },
    { data: promotedEvents },
    { data: allApprovedVenues },
    { data: recentlyExpiredSpotlightVenues },
    { data: recentlyExpiredPromoEvents },
  ] = await Promise.all([
    supabase
      .from("venues")
      .select("id, name, slug, spotlight_until, city:cities(name, slug)")
      .gt("spotlight_until", now)
      .order("spotlight_until", { ascending: true }),
    supabase
      .from("events")
      .select(
        "id, title, start_time, featured_until, highlighted_until, genre_takeover_until, weekend_boost_until, venue:venues!inner(id, name, slug, city:cities(slug))",
      )
      .or(
        `featured_until.gt.${now},highlighted_until.gt.${now},genre_takeover_until.gt.${now},weekend_boost_until.gt.${now}`,
      )
      .order("start_time", { ascending: true }),
    supabase
      .from("venues")
      .select("id, name, city:cities(name, slug)")
      .eq("approved", true)
      .order("name"),
    supabase
      .from("venues")
      .select("id, name, spotlight_until")
      .gte("spotlight_until", sevenDaysAgo)
      .lte("spotlight_until", now)
      .order("spotlight_until", { ascending: false }),
    supabase
      .from("events")
      .select(
        "id, title, start_time, featured_until, highlighted_until, genre_takeover_until, weekend_boost_until, venue:venues!inner(id, name)",
      )
      .or(
        `and(featured_until.gte.${sevenDaysAgo},featured_until.lte.${now}),` +
          `and(highlighted_until.gte.${sevenDaysAgo},highlighted_until.lte.${now}),` +
          `and(genre_takeover_until.gte.${sevenDaysAgo},genre_takeover_until.lte.${now}),` +
          `and(weekend_boost_until.gte.${sevenDaysAgo},weekend_boost_until.lte.${now})`,
      )
      .order("start_time", { ascending: true }),
  ]);

  return (
    <div className="container-page py-10 max-w-5xl">
      <Link
        href="/admin"
        className="text-sm text-buzz-mute hover:text-buzz-accent transition"
      >
        ← Back to admin
      </Link>
      <p className="eyebrow mt-3 mb-1">Admin · Promotions</p>
      <h1 className="h-display text-4xl sm:text-5xl mb-2">All active promotions</h1>
      <p className="text-buzz-mute mb-8">
        Everything currently boosted across The Buzz Guide. Cancel from here, or jump
        into any venue's promote page to grant new ones.
      </p>

      <PromotionsOverviewClient
        spotlightVenues={(spotlightVenues ?? []) as any}
        promotedEvents={(promotedEvents ?? []) as any}
        allVenues={(allApprovedVenues ?? []) as any}
        recentlyExpiredSpotlightVenues={
          (recentlyExpiredSpotlightVenues ?? []) as any
        }
        recentlyExpiredPromoEvents={
          (recentlyExpiredPromoEvents ?? []) as any
        }
      />
    </div>
  );
}
