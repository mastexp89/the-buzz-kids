import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import ArtistPhotosClient from "./ArtistPhotosClient";

export const dynamic = "force-dynamic";
export const metadata = { title: "Artist photos — The Buzz Guide admin" };

// Admin tool: bulk-fill missing artist profile photos by scraping the
// og:image off their Facebook page (or website). Preview each one before
// applying — FB sometimes serves the wrong image (login wall, generic
// FB logo, cover photo etc.) so we never auto-apply.
//
// Filter: only show artists with a facebook URL set. If admin wants to
// replace an existing image they can flip the toggle to show "all".

// Three views, plus a sort order:
//   filter=missing — has FB URL, no image (default, where most of the work is)
//   filter=all     — has FB URL, any image state (for replacing existing)
//   filter=no-fb   — NO FB URL yet, regardless of image state — admin
//                    Googles + pastes their FB page so they become eligible
//                    for the og:image puller.
//
// sort=newest puts most-recently-joined artists at the top, useful for the
// "what's appeared since I last ran this" pass.

type Filter = "missing" | "all" | "no-fb";

type Props = { searchParams: Promise<{ filter?: string; all?: string; sort?: string }> };

export default async function ArtistPhotosPage({ searchParams }: Props) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: me } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (me?.role !== "admin") {
    return (
      <div className="container-page py-16 text-center">
        <h1 className="h-display text-3xl mb-2">Admins only</h1>
        <Link href="/dashboard" className="btn-secondary mt-6 inline-block">Back to dashboard</Link>
      </div>
    );
  }

  const sp = await searchParams;
  // Back-compat: the old ?all=1 query string flips to filter=all.
  const filter: Filter =
    sp.filter === "all" || sp.all === "1" ? "all"
    : sp.filter === "no-fb" ? "no-fb"
    : "missing";
  const sortNewest = sp.sort === "newest";

  const sb = createServiceClient();
  let query = sb
    .from("artists")
    .select("id, name, slug, image_url, facebook, website, approved, created_at");

  if (filter === "no-fb") {
    // Artists without a Facebook URL — admin pastes one in to make them
    // eligible for the og:image puller.
    query = query.is("facebook", null);
  } else {
    // Both "missing" and "all" require a FB URL — that's what the puller needs.
    query = query.not("facebook", "is", null);
    if (filter === "missing") {
      query = query.is("image_url", null);
    }
  }

  query = sortNewest
    ? query.order("created_at", { ascending: false })
    : query.order("name");
  const { data: artists } = await query;

  // Counts for the filter pills.
  const [
    { count: totalWithFb },
    { count: missingImageCount },
    { count: noFbCount },
  ] = await Promise.all([
    sb.from("artists").select("id", { count: "exact", head: true }).not("facebook", "is", null),
    sb.from("artists").select("id", { count: "exact", head: true }).not("facebook", "is", null).is("image_url", null),
    sb.from("artists").select("id", { count: "exact", head: true }).is("facebook", null),
  ]);

  const braveConfigured = !!process.env.BRAVE_SEARCH_API_KEY;

  return (
    <div className="container-page py-10 max-w-4xl">
      <Link href="/admin" className="text-sm text-buzz-mute hover:text-buzz-accent transition">
        ← Back to admin
      </Link>
      <p className="eyebrow mt-3 mb-1">Admin · Artist photos</p>
      <h1 className="h-display text-4xl mb-2">📷 Pull artist pics from Facebook</h1>
      <p className="text-buzz-mute mb-6 max-w-2xl text-sm">
        Click <strong>Pull pic</strong> next to any artist to fetch their
        Facebook page&apos;s <code>og:image</code> and preview it next to the
        current image. Click <strong>Use this</strong> to save, or skip if it
        looks wrong. We never auto-apply — admin always reviews first.
      </p>

      {!braveConfigured && (
        <div className="card border-amber-500/40 bg-amber-500/5 p-4 mb-6 text-sm">
          <strong>⚙️ Heads-up:</strong> Auto-find for artists without a FB URL relies on a search API.
          Bing and DuckDuckGo are unreliable when scraped from Vercel —
          they 403 a lot. Sign up for{" "}
          <a
            href="https://brave.com/search/api/"
            target="_blank"
            rel="noopener noreferrer"
            className="text-buzz-accent underline"
          >
            Brave Search API
          </a>{" "}
          (free 2,000 queries/month, no credit card) and set{" "}
          <code className="text-buzz-accent">BRAVE_SEARCH_API_KEY</code> in
          Vercel env vars. The puller will use it automatically.{" "}
          <strong>Artist photos with a website set still work without this</strong> — we scrape the
          website for FB links first.
        </div>
      )}

      <div className="card p-3 mb-6 flex flex-col gap-3 text-sm">
        {/* Filter pills */}
        <div className="flex gap-2 flex-wrap items-center">
          <span className="text-xs text-buzz-mute uppercase tracking-wider font-bold mr-1">Show:</span>
          <FilterLink filter="missing" current={filter} sortNewest={sortNewest}>
            Missing image only ({missingImageCount ?? 0})
          </FilterLink>
          <FilterLink filter="all" current={filter} sortNewest={sortNewest}>
            All with a Facebook URL ({totalWithFb ?? 0})
          </FilterLink>
          <FilterLink filter="no-fb" current={filter} sortNewest={sortNewest}>
            🔎 Need FB URL ({noFbCount ?? 0})
          </FilterLink>
        </div>
        {/* Sort order — newest helps you triage what's appeared since
            the last run without re-scanning the whole list. */}
        <div className="flex gap-2 flex-wrap items-center">
          <span className="text-xs text-buzz-mute uppercase tracking-wider font-bold mr-1">Sort:</span>
          <SortLink newest={false} current={sortNewest} filter={filter}>A–Z</SortLink>
          <SortLink newest current={sortNewest} filter={filter}>🆕 Newest first</SortLink>
        </div>
      </div>

      <ArtistPhotosClient
        mode={filter === "no-fb" ? "find-fb" : "pull-pic"}
        artists={(artists ?? []).map((a) => ({
          id: a.id,
          name: a.name,
          slug: a.slug,
          imageUrl: a.image_url,
          facebookUrl: a.facebook,
          websiteUrl: a.website,
        }))}
      />
    </div>
  );
}

function FilterLink({
  filter,
  current,
  sortNewest,
  children,
}: {
  filter: Filter;
  current: Filter;
  sortNewest: boolean;
  children: React.ReactNode;
}) {
  const params = new URLSearchParams();
  if (filter !== "missing") params.set("filter", filter);
  if (sortNewest) params.set("sort", "newest");
  const qs = params.toString();
  const href = `/admin/artist-photos${qs ? `?${qs}` : ""}`;
  const active = filter === current;
  return (
    <Link
      href={href}
      className={
        active
          ? "px-3 py-1.5 rounded-full bg-buzz-accent text-black font-semibold"
          : "px-3 py-1.5 rounded-full bg-buzz-card border border-buzz-border hover:border-buzz-accent transition"
      }
    >
      {children}
    </Link>
  );
}

function SortLink({
  newest,
  current,
  filter,
  children,
}: {
  newest: boolean;
  current: boolean;
  filter: Filter;
  children: React.ReactNode;
}) {
  const params = new URLSearchParams();
  if (filter !== "missing") params.set("filter", filter);
  if (newest) params.set("sort", "newest");
  const qs = params.toString();
  const href = `/admin/artist-photos${qs ? `?${qs}` : ""}`;
  const active = newest === current;
  return (
    <Link
      href={href}
      className={
        active
          ? "px-3 py-1.5 rounded-full bg-buzz-accent text-black font-semibold"
          : "px-3 py-1.5 rounded-full bg-buzz-card border border-buzz-border hover:border-buzz-accent transition"
      }
    >
      {children}
    </Link>
  );
}
