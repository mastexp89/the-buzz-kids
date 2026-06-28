"use server";

// Find + merge duplicate venues. Catches the "X" vs "The X" / "X" vs
// "X!" / "X" vs "X " patterns that the OSM importer + manual entry
// sometimes produce.
//
// Merge moves every child row (events, extraction_batches, page_views,
// festival_venues) from the losers to the winner, drops claims (they're
// per-user-per-venue and not worth migrating), records a slug_redirects
// row so old links keep working, then deletes the loser rows.

import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { revalidatePath } from "next/cache";

async function requireAdmin() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: prof } = await supabase
    .from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (prof?.role !== "admin") return null;
  return { userId: user.id };
}

function normaliseVenueName(name: string): string {
  return String(name)
    .toLowerCase()
    .trim()
    .replace(/^the\s+/, "")
    .replace(/[^a-z0-9]+/g, "");
}

export type DupeVenue = {
  id: string;
  name: string;
  slug: string;
  approved: boolean;
  cityName: string | null;
  citySlug: string | null;
  address: string | null;
  postcode: string | null;
  hasFb: boolean;
  hasWebsite: boolean;
  ownerEmail: string | null;
  eventCount: number;
  createdAt: string;
};

export type DupeGroup = {
  key: string; // normalised name
  venues: DupeVenue[];
};

export type FindDupesResult =
  | { error: string }
  | { ok: true; groups: DupeGroup[]; totalDupes: number };

export async function findVenueDuplicates(
  citySlug?: string,
): Promise<FindDupesResult> {
  const ctx = await requireAdmin();
  if (!ctx) return { error: "Admins only." };

  const sb = createServiceClient();

  let cityIdFilter: string | null = null;
  if (citySlug) {
    const { data: city } = await sb
      .from("cities").select("id").eq("slug", citySlug).maybeSingle();
    if (!city) return { error: `Unknown city slug "${citySlug}"` };
    cityIdFilter = city.id;
  }

  const venuesBase = sb
    .from("venues")
    .select(
      "id, name, slug, approved, address, postcode, facebook, website, owner_id, created_at, city:cities(name, slug)",
    );
  const { data: venues } = await (cityIdFilter
    ? venuesBase.eq("city_id", cityIdFilter)
    : venuesBase);

  if (!venues || venues.length === 0) {
    return { ok: true, groups: [], totalDupes: 0 };
  }

  // Group by normalised name
  const byKey = new Map<string, any[]>();
  for (const v of venues) {
    const k = normaliseVenueName(v.name);
    if (!k) continue;
    const list = byKey.get(k) ?? [];
    list.push(v);
    byKey.set(k, list);
  }

  // Keep only groups with 2+ entries
  const dupeGroups = Array.from(byKey.entries()).filter(([, list]) => list.length > 1);
  if (dupeGroups.length === 0) {
    return { ok: true, groups: [], totalDupes: 0 };
  }

  // Decorate with event counts (one query, grouped client-side)
  const venueIds = dupeGroups.flatMap(([, list]) => list.map((v) => v.id));
  const { data: eventRows } = await sb
    .from("events")
    .select("venue_id")
    .in("venue_id", venueIds);
  const eventCountByVenue = new Map<string, number>();
  for (const e of eventRows ?? []) {
    eventCountByVenue.set(e.venue_id, (eventCountByVenue.get(e.venue_id) ?? 0) + 1);
  }

  // Owner emails
  const ownerIds = Array.from(
    new Set(venues.map((v: any) => v.owner_id).filter(Boolean) as string[]),
  );
  const ownerEmailById = new Map<string, string>();
  if (ownerIds.length > 0) {
    const { data: profs } = await sb
      .from("profiles").select("id, email").in("id", ownerIds);
    for (const p of profs ?? []) {
      if (p.email) ownerEmailById.set(p.id, p.email);
    }
  }

  const groups: DupeGroup[] = dupeGroups.map(([key, list]) => {
    const decorated: DupeVenue[] = list.map((v: any) => ({
      id: v.id,
      name: v.name,
      slug: v.slug,
      approved: !!v.approved,
      cityName: v.city?.name ?? null,
      citySlug: v.city?.slug ?? null,
      address: v.address ?? null,
      postcode: v.postcode ?? null,
      hasFb: !!v.facebook,
      hasWebsite: !!v.website,
      ownerEmail: v.owner_id ? ownerEmailById.get(v.owner_id) ?? null : null,
      eventCount: eventCountByVenue.get(v.id) ?? 0,
      createdAt: v.created_at,
    }));
    // Sort the group with the auto-suggested winner first: most events,
    // then has owner, then has FB URL, then oldest row.
    decorated.sort((a, b) => {
      if (a.eventCount !== b.eventCount) return b.eventCount - a.eventCount;
      if (!!a.ownerEmail !== !!b.ownerEmail) return a.ownerEmail ? -1 : 1;
      if (a.hasFb !== b.hasFb) return a.hasFb ? -1 : 1;
      if (a.hasWebsite !== b.hasWebsite) return a.hasWebsite ? -1 : 1;
      return a.createdAt.localeCompare(b.createdAt);
    });
    return { key, venues: decorated };
  });

  // Sort groups by total events descending so high-impact merges show first.
  groups.sort((a, b) => {
    const ae = a.venues.reduce((s, v) => s + v.eventCount, 0);
    const be = b.venues.reduce((s, v) => s + v.eventCount, 0);
    return be - ae;
  });

  return {
    ok: true,
    groups,
    totalDupes: groups.reduce((s, g) => s + g.venues.length - 1, 0),
  };
}

export type MergeVenuesResult =
  | { error: string }
  | {
      ok: true;
      winnerId: string;
      moved: { events: number; extractions: number; pageViews: number; festivalLinks: number };
      deletedClaims: number;
      redirectsCreated: number;
      losersDeleted: number;
    };

export async function mergeVenues(
  winnerId: string,
  loserIds: string[],
): Promise<MergeVenuesResult> {
  const ctx = await requireAdmin();
  if (!ctx) return { error: "Admins only." };
  if (loserIds.length === 0) return { error: "No losers to merge." };
  if (loserIds.includes(winnerId)) return { error: "Winner can't also be a loser." };

  const sb = createServiceClient();

  // Confirm winner + losers exist
  const allIds = [winnerId, ...loserIds];
  const { data: rows } = await sb
    .from("venues")
    .select("id, name, slug")
    .in("id", allIds);
  if (!rows || rows.length !== allIds.length) {
    return { error: "One or more venue IDs not found." };
  }
  const winner = rows.find((v) => v.id === winnerId)!;
  const losers = rows.filter((v) => v.id !== winnerId);

  // 1. Move events to winner
  const { count: eventsMoved } = await sb
    .from("events")
    .update({ venue_id: winnerId }, { count: "exact" })
    .in("venue_id", loserIds);

  // 2. Move extraction_batches
  const { count: extractionsMoved } = await sb
    .from("extraction_batches")
    .update({ venue_id: winnerId }, { count: "exact" })
    .in("venue_id", loserIds);

  // 3. Move page_views
  const { count: pageViewsMoved } = await sb
    .from("page_views")
    .update({ venue_id: winnerId }, { count: "exact" })
    .in("venue_id", loserIds);

  // 4. Move festival_venues (with conflict handling — if winner is already
  //    in the festival, just delete the loser link)
  let festivalLinksMoved = 0;
  const { data: festLinks } = await sb
    .from("festival_venues")
    .select("festival_id, venue_id")
    .in("venue_id", loserIds);
  for (const link of festLinks ?? []) {
    // Try to update — if it conflicts, the winner's already in this festival
    const { error: updErr } = await sb
      .from("festival_venues")
      .update({ venue_id: winnerId })
      .eq("festival_id", link.festival_id)
      .eq("venue_id", link.venue_id);
    if (updErr) {
      // Conflict — just delete the loser's link
      await sb
        .from("festival_venues")
        .delete()
        .eq("festival_id", link.festival_id)
        .eq("venue_id", link.venue_id);
    } else {
      festivalLinksMoved++;
    }
  }

  // 5. Drop venue_claims on losers (per-user-per-venue, not worth migrating)
  const { count: claimsDeleted } = await sb
    .from("venue_claims")
    .delete({ count: "exact" })
    .in("venue_id", loserIds);

  // 6. Record slug redirects so old URLs keep working
  let redirectsCreated = 0;
  for (const l of losers) {
    if (l.slug === winner.slug) continue;
    const { error } = await sb
      .from("slug_redirects")
      .upsert(
        {
          entity_type: "venue",
          old_slug: l.slug,
          new_slug: winner.slug,
        },
        { onConflict: "entity_type,old_slug" },
      );
    if (!error) redirectsCreated++;
  }

  // 7. Delete the losers
  const { count: losersDeleted } = await sb
    .from("venues")
    .delete({ count: "exact" })
    .in("id", loserIds);

  // Cache busting
  revalidatePath("/admin");
  revalidatePath("/admin/venues-dedupe");
  revalidatePath("/dundee");
  revalidatePath("/angus");

  return {
    ok: true,
    winnerId,
    moved: {
      events: eventsMoved ?? 0,
      extractions: extractionsMoved ?? 0,
      pageViews: pageViewsMoved ?? 0,
      festivalLinks: festivalLinksMoved,
    },
    deletedClaims: claimsDeleted ?? 0,
    redirectsCreated,
    losersDeleted: losersDeleted ?? 0,
  };
}
