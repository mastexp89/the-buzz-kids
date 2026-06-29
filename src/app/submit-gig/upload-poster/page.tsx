import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import PosterUploadFlow from "./PosterUploadFlow";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Upload poster — The Buzz Kids",
};

export default async function UploadPosterPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/submit-gig/upload-poster");

  const { data: me } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();

  const allowed = me && ["artist", "event_organiser", "venue_owner", "admin"].includes(me.role);
  if (!allowed) {
    return (
      <div className="container-page py-16 max-w-xl text-center">
        <p className="eyebrow mb-2">Upload poster</p>
        <h1 className="h-display text-3xl mb-3">Sign up as an artist or venue first</h1>
        <p className="text-buzz-mute mb-6">
          Poster uploads are for artists, bands, DJs and venue owners. Free to sign up — pick
          your role and you'll be able to upload posters straight away.
        </p>
        <div className="flex gap-2 justify-center flex-wrap">
          <Link href="/list-your-activity" className="btn-primary">List your activity</Link>
        </div>
      </div>
    );
  }

  const { data: venues } = await supabase
    .from("venues")
    .select("id, name, slug, city:cities(name)")
    .eq("approved", true)
    .order("name");

  return (
    <div className="container-page py-10 max-w-4xl">
      <Link href="/submit-gig" className="text-sm text-buzz-mute hover:text-buzz-accent transition">
        ← Back to manual submission
      </Link>
      <p className="eyebrow mt-3 mb-1">Submit a gig</p>
      <h1 className="h-display text-4xl mb-2">Upload a poster</h1>
      <p className="text-buzz-mute mb-8 max-w-2xl">
        Drop in your gig poster and we'll read the title, date, time and lineup off it.
        You can review and tweak before publishing.
      </p>

      <PosterUploadFlow venues={(venues ?? []) as any} />
    </div>
  );
}
