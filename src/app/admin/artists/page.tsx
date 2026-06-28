import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import ArtistsClient from "./ArtistsClient";

export const dynamic = "force-dynamic";

export const metadata = { title: "All artists — The Buzz Guide" };

export default async function AdminArtistsPage() {
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

  // Page through every artist. The old .limit(500) was hard-capping the
  // list; even removing the limit, Supabase / PostgREST defaults to a
  // 1000-row response cap. So we explicitly page in chunks of 1000 until
  // we get a short page (= we've hit the end).
  const PAGE_SIZE = 1000;
  const artists: any[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data: page } = await supabase
      .from("artists")
      .select("id, name, slug, image_url, approved, claimed_by, created_at")
      .order("created_at", { ascending: false })
      .range(from, from + PAGE_SIZE - 1);
    if (!page || page.length === 0) break;
    artists.push(...page);
    if (page.length < PAGE_SIZE) break;
  }

  // For each artist, count how many upcoming gigs they're tagged on.
  // The event_artists .in() query needs chunking too: a single URL with
  // 2000+ UUIDs would exceed PostgREST's request length limit, and the
  // response itself would also hit the 1000-row cap.
  const artistIds = artists.map((a) => a.id);
  const upcomingByArtist = new Map<string, number>();
  if (artistIds.length > 0) {
    const now = new Date().toISOString();
    const IN_CHUNK = 200; // keeps the URL under ~16 KB even with UUIDs
    for (let i = 0; i < artistIds.length; i += IN_CHUNK) {
      const chunk = artistIds.slice(i, i + IN_CHUNK);
      // For each chunk also page in case a small artist set still has
      // hundreds of upcoming-event links between them.
      for (let from = 0; ; from += PAGE_SIZE) {
        const { data: links } = await supabase
          .from("event_artists")
          .select("artist_id, event:events!inner(start_time, status, cancelled)")
          .in("artist_id", chunk)
          .range(from, from + PAGE_SIZE - 1);
        if (!links || links.length === 0) break;
        for (const l of links) {
          const ev = (l as any).event;
          if (!ev) continue;
          if (ev.cancelled) continue;
          if (ev.status && ev.status !== "approved") continue;
          if (new Date(ev.start_time) < new Date(now)) continue;
          upcomingByArtist.set(l.artist_id, (upcomingByArtist.get(l.artist_id) ?? 0) + 1);
        }
        if (links.length < PAGE_SIZE) break;
      }
    }
  }

  // Look up emails for any artists that have been claimed by a real
  // account. Chunked for the same URL-length / row-cap reasons above,
  // even though claimed artists are typically a small fraction.
  const claimerIds = Array.from(new Set(artists.map((a) => a.claimed_by).filter(Boolean) as string[]));
  const claimerMap = new Map<string, { email: string | null; display_name: string | null }>();
  if (claimerIds.length > 0) {
    const IN_CHUNK = 200;
    for (let i = 0; i < claimerIds.length; i += IN_CHUNK) {
      const chunk = claimerIds.slice(i, i + IN_CHUNK);
      const { data: profs } = await supabase
        .from("profiles")
        .select("id, email, display_name")
        .in("id", chunk);
      for (const p of profs ?? []) {
        claimerMap.set(p.id, { email: p.email, display_name: p.display_name });
      }
    }
  }

  const enriched = artists.map((a: any) => ({
    ...a,
    upcoming_count: upcomingByArtist.get(a.id) ?? 0,
    claimer: a.claimed_by ? claimerMap.get(a.claimed_by) ?? null : null,
  }));

  const pending = enriched.filter((a) => !a.approved);
  const approved = enriched.filter((a) => a.approved);

  return (
    <div className="container-page py-10 max-w-5xl">
      <Link href="/admin" className="text-sm text-buzz-mute hover:text-buzz-accent transition">
        ← Back to admin
      </Link>
      <p className="eyebrow mt-3 mb-1">Admin</p>
      <h1 className="h-display text-4xl sm:text-5xl mb-2">All artists</h1>
      <p className="text-buzz-mute mb-8 max-w-2xl">
        Every artist on The Buzz Guide — auto-created from gig listings or registered by the artist themselves.
        Pending artists don't appear publicly until approved.
      </p>

      <ArtistsClient pending={pending as any} approved={approved as any} />
    </div>
  );
}
