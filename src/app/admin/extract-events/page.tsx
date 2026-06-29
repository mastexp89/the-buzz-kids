import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import ExtractClient from "./ExtractClient";
import PosterBackfillPanel from "./PosterBackfillPanel";
import PosterRediscoverPanel from "./PosterRediscoverPanel";

export const dynamic = "force-dynamic";

export const metadata = { title: "Extract events — The Buzz Kids admin" };

export default async function ExtractEventsPage() {
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

  // Pull approved venues for the picker — focus on auto-imported ones first since they're
  // the most likely targets for AI extraction (no owner, no manual gigs yet).
  const { data: venues } = await supabase
    .from("venues")
    .select("id, name, slug, facebook, website, auto_imported, owner_id, city:cities(name, slug)")
    .order("auto_imported", { ascending: false })
    .order("name")
    .limit(500);

  return (
    <div className="container-page py-10 max-w-4xl">
      <Link href="/admin" className="text-sm text-buzz-mute hover:text-buzz-accent transition">
        ← Back to admin
      </Link>
      <p className="eyebrow mt-3 mb-1">Admin</p>
      <h1 className="h-display text-4xl sm:text-5xl mb-2">Extract events</h1>
      <p className="text-buzz-mute mb-8 max-w-2xl">
        Drop in a Facebook post, a poster image, or a chunk of text from a venue's website,
        and Claude will pull the gigs / sports screenings / quizzes / DJ nights out of it.
        Results land in the venue's pending events queue (or auto-publish if it's an
        unclaimed venue). Tune the AI prompt by trying real posts here before turning on
        the bulk scraper.
      </p>

      <ExtractClient venues={(venues ?? []) as any} />

      <PosterBackfillPanel />
      <PosterRediscoverPanel />
    </div>
  );
}
