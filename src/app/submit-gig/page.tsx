import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import SubmitGigForm from "./SubmitGigForm";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Submit a gig — The Buzz Kids",
  description: "Playing a gig at one of our venues? Submit it and we'll get it listed.",
};

export default async function SubmitGigPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login?next=/submit-gig");
  }

  const [{ data: cities }, { data: venues }, { data: genres }] = await Promise.all([
    supabase.from("cities").select("id, name, slug, active").eq("active", true).order("name"),
    supabase
      .from("venues")
      .select("id, name, slug, address, postcode, city_id, city:cities(name, slug)")
      .eq("approved", true)
      .order("name"),
    supabase.from("genres").select("id, name, slug").order("name"),
  ]);

  return (
    <div className="container-page py-10 max-w-3xl">
      <Link href="/" className="text-sm text-buzz-mute hover:text-buzz-accent transition">
        ← Back to home
      </Link>
      <p className="eyebrow mt-3 mb-1">For artists, bands & DJs</p>
      <h1 className="h-display text-4xl sm:text-5xl mb-3">Submit a gig</h1>
      <p className="text-buzz-mute mb-8 max-w-xl">
        Tell us about your upcoming show. Pick the venue you're playing at — if it's already on
        The Buzz Guide, the venue owner will approve and publish your gig. If they're not on yet,
        we'll let them know you're trying to get them listed.
      </p>


      <a
        href="/submit-gig/upload-poster"
        className="card-hover p-4 mb-8 flex items-center gap-3 max-w-xl"
      >
        <span className="text-3xl">📸</span>
        <div className="flex-1">
          <div className="font-semibold text-buzz-text">Got a poster? Upload it instead</div>
          <div className="text-sm text-buzz-mute">
            We'''ll read the date, time and lineup off the image. Quicker than typing.
          </div>
        </div>
        <span className="text-buzz-accent text-lg">→</span>
      </a>

      <SubmitGigForm
        cities={(cities ?? []) as any}
        venues={(venues ?? []) as any}
        genres={(genres ?? []) as any}
      />
    </div>
  );
}
