import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import ArtistsIndexClient from "./ArtistsIndexClient";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Artists, bands, DJs & hosts — The Buzz Kids",
  description: "Browse every artist, band, DJ and host with upcoming or past gigs on The Buzz Guide.",
};

export default async function ArtistsIndexPage() {
  const supabase = await createClient();

  // Pull every approved artist plus an upcoming-gig count (computed in-app).
  const { data: artists } = await supabase
    .from("artists")
    .select(`
      id, name, slug, image_url, claimed_by,
      event_artists (
        event:events!inner (
          id, start_time, status, cancelled,
          venue:venues!inner ( id, approved )
        )
      )
    `)
    .eq("approved", true)
    .order("name");

  const now = new Date();
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);

  const enriched = (artists ?? []).map((a: any) => {
    const events = (a.event_artists ?? [])
      .map((ea: any) => ea.event)
      .filter(Boolean) as any[];
    const upcoming = events.filter((e) =>
      e &&
      e.status === "approved" &&
      !e.cancelled &&
      e.venue?.approved &&
      new Date(e.start_time).getTime() >= startOfToday.getTime(),
    ).length;
    const total = events.filter((e) =>
      e &&
      e.status === "approved" &&
      e.venue?.approved,
    ).length;
    return {
      id: a.id,
      name: a.name,
      slug: a.slug,
      image_url: a.image_url ?? null,
      claimed: !!a.claimed_by,
      upcoming,
      total,
    };
  });

  // Sort: upcoming gigs desc, then total gigs desc, then name
  enriched.sort((a, b) => {
    if (b.upcoming !== a.upcoming) return b.upcoming - a.upcoming;
    if (b.total !== a.total) return b.total - a.total;
    return a.name.localeCompare(b.name);
  });

  return (
    <div className="container-page py-10 sm:py-14 max-w-6xl">
      <p className="eyebrow mb-1">All on The Buzz Guide</p>
      <h1 className="h-display text-4xl sm:text-6xl mb-2">
        Artists, bands, DJs &amp; hosts
      </h1>
      <p className="text-buzz-mute mb-8 max-w-2xl">
        Every act with an upcoming (or recent) gig on The Buzz Guide. Click through to see
        their gigs, follow their socials, or claim your own page if you're one of them.
      </p>

      <ArtistsIndexClient artists={enriched} />

      <div className="mt-10 text-sm text-buzz-mute">
        Don't see yourself?{" "}
        <Link href="/submit-gig" className="text-buzz-accent hover:text-buzz-accent2">
          Submit a gig
        </Link>{" "}
        and your artist page will be auto-created.
      </div>
    </div>
  );
}
