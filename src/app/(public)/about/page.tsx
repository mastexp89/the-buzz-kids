import Link from "next/link";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "About — The Buzz Guide" };

export default async function AboutPage() {
  const supabase = await createClient();
  const { data: activeCities } = await supabase
    .from("cities")
    .select("name, slug")
    .eq("active", true)
    .order("name");
  const cities = activeCities ?? [];
  const browseHref = cities.length === 1 ? `/${cities[0].slug}` : "/";
  // "Browse Locations" rather than "Browse cities" — many of our city
  // rows are actually regions (Angus, Fife) that cover multiple towns.
  const browseLabel = cities.length === 1 ? `Browse ${cities[0].name}` : "Browse Locations";

  return (
    <div className="container-page py-12 max-w-3xl">
      <p className="eyebrow mb-2">About</p>
      <h1 className="h-display text-5xl mb-6">The Buzz Guide.</h1>

      <p className="text-buzz-text/90 leading-relaxed mb-6">
        The Buzz Guide is a directory of pubs, gigs and nights out in Scottish cities. Live music,
        DJs, karaoke, quiz nights, sports screenings — whatever's on, your local pubs and
        venues post their schedules so you can find a night in seconds, by date, genre or venue.
      </p>

      <h2 className="h-display text-2xl mt-10 mb-2">For music fans &amp; nights-out crowd</h2>
      <p className="text-buzz-mute leading-relaxed">
        Free to browse — no account needed. Pick a city and a vibe and go.
        Add events straight to your calendar. Share with mates.
      </p>
      <p className="text-buzz-mute leading-relaxed mt-3">
        Want a bit more? <Link href="/signup?as=fan" className="text-buzz-accent">Create a free fan account</Link>{" "}
        and you can heart your favourite venues, bands and gigs. We'll email you when they
        announce something new, send a morning-of digest of what you've saved for the day, and
        ping you 15 minutes before each gig kicks off. There's also a day planner with a map
        view of everywhere you're heading — handy for festivals or busy weekends.
      </p>

      <h2 className="h-display text-2xl mt-10 mb-2">For venues</h2>
      <p className="text-buzz-mute leading-relaxed">
        Free to list. Add your gigs, photos and venue details, and they'll show up wherever
        people are looking — on the city page, on your venue page and via search. Optional paid
        promotions are available if you want a gig pinned or featured. Got questions?{" "}
        <a href="mailto:admin@thebuzzguide.co.uk?subject=Listing%20a%20venue" className="text-buzz-accent">Get in touch</a>.
      </p>

      <h2 className="h-display text-2xl mt-10 mb-2">For artists, bands & DJs</h2>
      <p className="text-buzz-mute leading-relaxed">
        Free to list. Submit a gig, claim your artist page, add a bio and your socials so fans
        can find you. <Link href="/submit-gig" className="text-buzz-accent">Submit a gig</Link>{" "}
        or <Link href="/artists" className="text-buzz-accent">browse the directory</Link>.
      </p>

      <h2 className="h-display text-2xl mt-10 mb-2">For local businesses</h2>
      <p className="text-buzz-mute leading-relaxed">
        Want to be in front of locals heading out for a night? <Link href="/advertise" className="text-buzz-accent">Advertise with us</Link>.
      </p>

      <h2 className="h-display text-2xl mt-10 mb-2">Coming next</h2>
      <p className="text-buzz-mute leading-relaxed">
        We're rolling out across Scotland — Edinburgh, Glasgow, Aberdeen, Perth and Stirling
        are next on the list. If you'd like to be the first venue listed in your city, drop us a line at{" "}
        <a href="mailto:admin@thebuzzguide.co.uk" className="text-buzz-accent">admin@thebuzzguide.co.uk</a>.
      </p>

      <div className="mt-10 flex flex-wrap gap-3">
        <Link href={browseHref} className="btn-primary">{browseLabel}</Link>
        <Link href="/signup" className="btn-secondary">List your venue free</Link>
        <Link href="/advertise" className="btn-secondary">Advertise with us</Link>
      </div>
    </div>
  );
}
