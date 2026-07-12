import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { addAggregatorSource, deleteAggregatorSource, toggleAggregatorSource, dismissAggregatorPlace } from "./actions";
import RunNow from "./RunNow";

export const dynamic = "force-dynamic";
// The "Run now" server action lives on this route — give it the same long
// budget as the cron so a live run has time to AI-extract a batch.
export const maxDuration = 300;
export const metadata = { title: "Auto-import feeds — The Buzz Kids admin" };

export default async function AggregatorPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/admin/aggregator");
  const { data: me } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (me?.role !== "admin") {
    return (
      <div className="container-page py-16 text-center">
        <h1 className="h-display text-3xl mb-2">Admins only</h1>
        <Link href="/admin" className="btn-secondary mt-6 inline-block">Back to admin</Link>
      </div>
    );
  }

  const sb = createServiceClient();
  let tablesMissing = false;
  let sources: any[] = [];
  let seenCount = 0;
  let places: any[] = [];
  try {
    const sRes = await sb.from("aggregator_sources").select("*").order("label");
    if (sRes.error) throw sRes.error;
    sources = sRes.data ?? [];
    const { count } = await sb.from("aggregator_seen").select("source_url", { count: "exact", head: true });
    seenCount = count ?? 0;
    const { data: pl } = await sb
      .from("aggregator_places").select("id, name, location, website, source_url, city_slug")
      .eq("status", "new").order("found_at", { ascending: false }).limit(500);
    places = pl ?? [];
  } catch {
    tablesMissing = true;
  }

  const fmt = (d: string | null) => (d ? new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "never");

  return (
    <div className="container-page py-10 max-w-3xl">
      <Link href="/admin" className="text-sm text-buzz-mute hover:text-buzz-accent transition">← Back to admin</Link>
      <p className="eyebrow mt-4 mb-1">Ops</p>
      <h1 className="h-display text-4xl sm:text-5xl mb-2">Auto-import feeds 🔁</h1>
      <p className="text-buzz-mute mb-6 max-w-xl">
        Regional &ldquo;what&apos;s on&rdquo; portals swept weekly into the{" "}
        <Link href="/admin/queue" className="text-buzz-accent">review queue</Link>. Each run only pulls
        <strong> new</strong> listings (it remembers what it&apos;s already seen), keeps family-suitable events,
        drops adult ones, and files attractions as{" "}
        <Link href="/admin/suggestions" className="text-buzz-accent">place suggestions</Link>. Nothing goes live
        without your approval.
      </p>

      {tablesMissing ? (
        <div className="rounded-xl px-4 py-3 text-sm" style={{ background: "#FDECEC", color: "#a3282a" }}>
          ⚠ Run <code>sql/091_aggregator_sources.sql</code> in Supabase, then refresh.
        </div>
      ) : (
        <>
          <div className="card p-4 mb-6">
            <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
              <div>
                <p className="text-sm font-medium">Run it now</p>
                <p className="text-xs text-buzz-mute">Dry run first to preview · live run adds to the queue (£ AI cost).</p>
              </div>
              <span className="text-xs text-buzz-mute">{seenCount} listings processed all-time</span>
            </div>
            <RunNow />
          </div>

          {/* Places found — attractions to add to the directory (no emails). */}
          {places.length > 0 && (
            <section className="mb-8">
              <h2 className="font-display text-2xl mb-1">Places found ({places.length})</h2>
              <p className="text-sm text-buzz-mute mb-3">
                New attractions the sweep spotted (deduped against places you already have). Add the good ones as venues; dismiss the rest.
              </p>
              <div className="flex flex-col gap-2">
                {places.map((p) => (
                  <div key={p.id} className="rounded-lg border border-buzz-border bg-buzz-card p-3 flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-medium truncate">
                        {p.name}
                        {p.location ? <span className="text-buzz-mute font-normal"> · {p.location}</span> : null}
                      </div>
                      {p.source_url && (
                        <a href={p.source_url} target="_blank" rel="noopener" className="text-[11px] text-buzz-accent hover:underline break-all">view source ↗</a>
                      )}
                    </div>
                    <div className="flex gap-1.5 shrink-0 items-center">
                      <a
                        href={`/admin/venues/new?name=${encodeURIComponent(p.name)}${p.website ? `&website=${encodeURIComponent(p.website)}` : ""}`}
                        target="_blank"
                        rel="noopener"
                        className="btn-secondary text-xs whitespace-nowrap"
                      >
                        Add as venue →
                      </a>
                      <form action={dismissAggregatorPlace}>
                        <input type="hidden" name="id" value={p.id} />
                        <button className="text-xs text-buzz-mute hover:text-red-600 px-1" title="Dismiss">Dismiss</button>
                      </form>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          <h2 className="font-display text-2xl mb-3">Feeds ({sources.length})</h2>
          <div className="flex flex-col gap-2 mb-5">
            {sources.map((s) => (
              <div key={s.id} className="rounded-lg border border-buzz-border bg-buzz-card p-3 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-medium truncate">
                    {s.label || s.url}
                    {!s.active && <span className="ml-2 text-[10px] uppercase tracking-wide text-buzz-mute">paused</span>}
                  </div>
                  <a href={s.url} target="_blank" rel="noopener" className="text-[11px] text-buzz-accent hover:underline break-all">{s.url}</a>
                  <p className="text-[11px] text-buzz-mute mt-0.5">
                    {s.city_slug ? `📍 ${s.city_slug} · ` : ""}last run {fmt(s.last_run_at)}
                    {s.last_run_at ? ` (+${s.last_new_events} events, +${s.last_new_places} places)` : ""}
                  </p>
                </div>
                <div className="flex gap-1 shrink-0">
                  <form action={toggleAggregatorSource}>
                    <input type="hidden" name="id" value={s.id} />
                    <input type="hidden" name="active" value={(!s.active).toString()} />
                    <button className="text-xs text-buzz-mute hover:text-buzz-accent px-2 py-1">{s.active ? "Pause" : "Resume"}</button>
                  </form>
                  <form action={deleteAggregatorSource}>
                    <input type="hidden" name="id" value={s.id} />
                    <button className="text-xs text-red-600 hover:underline px-2 py-1">Delete</button>
                  </form>
                </div>
              </div>
            ))}
            {sources.length === 0 && <p className="text-sm text-buzz-mute">No feeds yet — add one below.</p>}
          </div>

          <h2 className="font-display text-2xl mb-2">Add a feed</h2>
          <form action={addAggregatorSource} className="rounded-lg border border-dashed border-buzz-border p-3 flex flex-col gap-2">
            <input name="url" placeholder="https://visit-x.com/whats-on-category/children-family/" className="h-10 rounded-lg border border-buzz-border bg-buzz-bg px-3 text-sm" />
            <div className="flex gap-2 flex-wrap">
              <input name="label" placeholder="Label (e.g. Visit Fife — Children)" className="flex-1 min-w-[160px] h-10 rounded-lg border border-buzz-border bg-buzz-bg px-3 text-sm" />
              <input name="city_slug" placeholder="city slug (e.g. fife)" className="w-40 h-10 rounded-lg border border-buzz-border bg-buzz-bg px-3 text-sm" />
            </div>
            <p className="text-[11px] text-buzz-mute">The city slug tags every event from this feed to that region (must match a city in your directory).</p>
            <button className="btn-secondary text-sm self-start">Add feed</button>
          </form>
        </>
      )}
    </div>
  );
}
