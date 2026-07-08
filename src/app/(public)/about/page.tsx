import Link from "next/link";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "About — The Buzz Kids" };

export default async function AboutPage() {
  const supabase = await createClient();
  const { data: activeCities } = await supabase
    .from("cities")
    .select("name, slug")
    .eq("active", true)
    .order("name");
  const cities = activeCities ?? [];
  const browseHref = cities.length === 1 ? `/${cities[0].slug}` : "/browse";
  const browseLabel = cities.length === 1 ? `Browse ${cities[0].name}` : "Browse all areas";

  return (
    <div className="container-page py-12 max-w-3xl">
      <p className="eyebrow mb-2">About</p>
      <h1 className="h-display text-5xl mb-6">The Buzz Kids.</h1>

      <p className="text-buzz-text/90 leading-relaxed mb-6">
        The Buzz Kids is a free directory of kid-friendly things to do across Scotland — soft play,
        farm parks, holiday clubs, messy play, kids' theatre, leisure centres and more. We pull
        everything together in one place so parents and carers can find something brilliant to do
        without spending an hour searching Facebook and Google.
      </p>

      <h2 className="h-display text-2xl mt-10 mb-2">For parents &amp; carers</h2>
      <p className="text-buzz-mute leading-relaxed">
        Free to browse — no account needed. Filter by age range, price, whether it's indoor or
        outdoor, and what your kids are into. We cover multiple areas across Scotland and we're
        expanding all the time.
      </p>
      <p className="text-buzz-mute leading-relaxed mt-3">
        Want a bit more?{" "}
        <Link href="/signup?as=fan" className="text-buzz-accent">Create a free parent account</Link>{" "}
        and you can save places to your bucket list and get
        alerts when new sessions are added for the school holidays.
      </p>

      <h2 className="h-display text-2xl mt-10 mb-2">For activity providers &amp; venues</h2>
      <p className="text-buzz-mute leading-relaxed">
        Free to list, free forever. Whether you run a soft play, farm park, leisure centre,
        holiday club, kids' theatre or touring workshop — add your place, upload your sessions
        and reach local families looking for things to do. Got questions?{" "}
        <a href="mailto:hello@thebuzzkids.co.uk?subject=Listing%20a%20place" className="text-buzz-accent">
          Get in touch
        </a>.
      </p>

      <h2 className="h-display text-2xl mt-10 mb-2">Our sister site</h2>
      <p className="text-buzz-mute leading-relaxed">
        The Buzz Kids is a sister site to{" "}
        <a href="https://www.thebuzzguide.co.uk" target="_blank" rel="noopener" className="text-buzz-accent">
          The Buzz Guide
        </a>
        {" "}— our grown-ups' guide to live music, DJs, comedy and nights out across Scotland.
        Both sites are free to use and free to list on.
      </p>

      <h2 className="h-display text-2xl mt-10 mb-2">Coming next</h2>
      <p className="text-buzz-mute leading-relaxed">
        We're rolling out across Scotland. If you'd like your area covered sooner, or you run a
        place that should be on here, drop us a line at{" "}
        <a href="mailto:hello@thebuzzkids.co.uk" className="text-buzz-accent">
          hello@thebuzzkids.co.uk
        </a>.
      </p>

      <div className="mt-10 flex flex-wrap gap-3">
        <Link href={browseHref} className="btn-primary">{browseLabel}</Link>
        <Link href="/list-your-activity" className="btn-secondary">List your place free</Link>
        <Link href="/signup?as=fan" className="btn-secondary">Create a parent account</Link>
      </div>
    </div>
  );
}
