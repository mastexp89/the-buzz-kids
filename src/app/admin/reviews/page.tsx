import Link from "next/link";
import { createServiceClient } from "@/lib/supabase/service";
import ReviewModeration from "./ReviewModeration";

export const dynamic = "force-dynamic";
export const metadata = { title: "Reviews — Admin" };

function Stars({ n }: { n: number }) {
  const v = Math.max(0, Math.min(5, Math.round(n)));
  return <span style={{ color: "#F9A11B" }}>{"★".repeat(v)}<span style={{ color: "#D6E2EC" }}>{"★".repeat(5 - v)}</span></span>;
}

const STATUS_STYLE: Record<string, string> = {
  pending: "bg-amber-100 text-amber-800",
  approved: "bg-emerald-100 text-emerald-800",
  hidden: "bg-rose-100 text-rose-800",
};

export default async function AdminReviewsPage() {
  const sb = createServiceClient();
  const { data } = await sb
    .from("reviews")
    .select("id, rating, title, body, status, created_at, author:profiles(display_name), venue:venues(name, slug, city:cities(slug)), images:review_images(image_url)")
    .order("created_at", { ascending: false });

  const reviews = (data ?? []) as any[];
  const pending = reviews.filter((r) => r.status === "pending");
  const others = reviews.filter((r) => r.status !== "pending");

  const Card = ({ r }: { r: any }) => (
    <div className="card p-4 flex flex-col gap-2">
      <div className="flex items-center gap-2 flex-wrap">
        <span className={`text-[10px] uppercase tracking-wide px-2 py-0.5 rounded-full font-bold ${STATUS_STYLE[r.status] ?? ""}`}>{r.status}</span>
        <Stars n={r.rating} />
        <span className="text-sm font-medium">{r.author?.display_name || "A parent"}</span>
        <span className="text-xs text-buzz-mute">on</span>
        {r.venue?.slug ? (
          <Link href={`/${r.venue?.city?.slug ?? "dundee"}/venues/${r.venue.slug}`} className="text-sm text-buzz-accent hover:text-buzz-accent2">{r.venue?.name}</Link>
        ) : (
          <span className="text-sm">{r.venue?.name}</span>
        )}
        <span className="ml-auto text-xs text-buzz-mute">{new Date(r.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}</span>
      </div>
      {r.title && <div className="font-semibold text-sm">{r.title}</div>}
      {r.body && <p className="text-sm text-buzz-text/90 whitespace-pre-line">{r.body}</p>}
      {(r.images ?? []).length > 0 && (
        <div className="flex flex-wrap gap-2">
          {(r.images ?? []).map((img: any, i: number) => (
            <a key={i} href={img.image_url} target="_blank" rel="noopener" className="block w-16 h-16 rounded-lg bg-buzz-surface bg-cover bg-center border border-buzz-border" style={{ backgroundImage: `url(${img.image_url})` }} aria-label="Review photo" />
          ))}
        </div>
      )}
      <ReviewModeration id={r.id} status={r.status} />
    </div>
  );

  return (
    <div className="flex flex-col gap-8 max-w-3xl">
      <div>
        <p className="eyebrow mb-1">Admin</p>
        <h1 className="h-display text-4xl">Reviews</h1>
        <p className="text-buzz-mute text-sm mt-1">Approve reviews to publish them, or hide anything that shouldn't be here.</p>
      </div>

      <section>
        <h2 className="font-display text-xl uppercase mb-3">Awaiting approval ({pending.length})</h2>
        {pending.length === 0 ? (
          <p className="text-buzz-mute text-sm">Nothing waiting. 🎉</p>
        ) : (
          <div className="flex flex-col gap-3">{pending.map((r) => <Card key={r.id} r={r} />)}</div>
        )}
      </section>

      {others.length > 0 && (
        <section>
          <h2 className="font-display text-xl uppercase mb-3">Everything else ({others.length})</h2>
          <div className="flex flex-col gap-3">{others.map((r) => <Card key={r.id} r={r} />)}</div>
        </section>
      )}
    </div>
  );
}
