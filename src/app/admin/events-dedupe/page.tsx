import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import EventsDedupeClient from "./EventsDedupeClient";

export const dynamic = "force-dynamic";
export const metadata = { title: "Dedupe events — The Buzz Guide admin" };

type Props = { searchParams: Promise<{ festival?: string }> };

export default async function EventsDedupePage({ searchParams }: Props) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: me } = await supabase
    .from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (me?.role !== "admin") {
    return (
      <div className="container-page py-16 text-center">
        <h1 className="h-display text-3xl mb-2">Admins only</h1>
        <Link href="/dashboard" className="btn-secondary mt-6 inline-block">Back to dashboard</Link>
      </div>
    );
  }

  // Load every festival (published or draft) so admin can scope while
  // still building out a festival lineup. Service-role would normally be
  // overkill here, but admin already passes the role check above.
  const { data: festivals } = await supabase
    .from("festivals")
    .select("id, name, slug, start_date, end_date, published")
    .order("start_date", { ascending: true });

  const sp = await searchParams;
  const selectedFestivalSlug = sp.festival ?? null;

  return (
    <div className="container-page py-10 max-w-5xl">
      <Link href="/admin" className="text-sm text-buzz-mute hover:text-buzz-accent transition">
        ← Back to admin
      </Link>
      <p className="eyebrow mt-3 mb-1">Admin</p>
      <h1 className="h-display text-4xl sm:text-5xl mb-2">🧹 Dedupe events</h1>
      <p className="text-buzz-mute mb-8 max-w-2xl">
        Finds events at the same venue on the same day with matching or
        overlapping titles — looser than the nightly auto-dedupe cron, which
        only catches same-hour clusters. Pick the keeper in each group and
        click <strong>Merge</strong>: artists, organisers, genres and favourites
        re-point to the keeper, blank image/description fields get filled in,
        and the loser rows are deleted. Notifications + page-view rows cascade
        with the FK.
      </p>

      <EventsDedupeClient
        festivals={(festivals ?? []).map((f) => ({
          id: f.id,
          name: f.name,
          slug: f.slug,
          startDate: f.start_date,
          endDate: f.end_date,
          published: !!f.published,
        }))}
        initialFestivalSlug={selectedFestivalSlug}
      />
    </div>
  );
}
