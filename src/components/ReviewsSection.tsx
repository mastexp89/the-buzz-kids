import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import ReviewForm from "@/components/ReviewForm";

function Stars({ n }: { n: number }) {
  const v = Math.max(0, Math.min(5, Math.round(n)));
  return (
    <span aria-label={`${v} out of 5`}>
      <span style={{ color: "#F9A11B" }}>{"★".repeat(v)}</span>
      <span style={{ color: "#D6E2EC" }}>{"★".repeat(5 - v)}</span>
    </span>
  );
}

export default async function ReviewsSection({ venueId, venueName }: { venueId: string; venueName: string }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  // Service client: profiles RLS hides other users, but reviews show the
  // author's name + avatar publicly. We only select safe fields.
  const sb = createServiceClient();
  const { data: rows } = await sb
    .from("reviews")
    .select("id, author_id, rating, title, body, created_at, status, author:profiles(display_name, avatar_url), images:review_images(image_url, sort_order)")
    .eq("venue_id", venueId)
    .order("created_at", { ascending: false });

  const all = (rows ?? []) as any[];
  const mine = user ? all.find((r) => r.author_id === user.id) : null;
  const approved = all.filter((r) => r.status === "approved");
  const publicReviews = approved.filter((r) => r.author_id !== user?.id);
  const avg = approved.length ? approved.reduce((s, r) => s + r.rating, 0) / approved.length : 0;

  return (
    <section className="mt-12 pt-10 border-t border-buzz-border">
      <div className="flex items-end justify-between gap-4 mb-6">
        <div>
          <p className="eyebrow mb-1">Reviews</p>
          <h2 className="h-display text-3xl sm:text-4xl">What parents say</h2>
        </div>
        {approved.length > 0 && (
          <div className="text-right shrink-0">
            <div className="text-2xl"><Stars n={avg} /></div>
            <div className="text-xs text-buzz-mute">{avg.toFixed(1)} · {approved.length} review{approved.length === 1 ? "" : "s"}</div>
          </div>
        )}
      </div>

      {/* Leave / edit your review */}
      {user ? (
        <div className="mb-8">
          {mine?.status === "pending" && (
            <div className="card p-4 mb-3 text-sm text-buzz-mute">
              ⏳ Thanks — your review is awaiting a quick check before it appears. You can tweak it below.
            </div>
          )}
          <ReviewForm
            venueId={venueId}
            existing={mine ? { rating: mine.rating, title: mine.title, body: mine.body, images: (mine.images ?? []).map((i: any) => i.image_url) } : null}
          />
        </div>
      ) : (
        <div className="card p-5 mb-8 text-sm text-buzz-mute">
          Been to {venueName}?{" "}
          <Link href="/signup?as=fan" className="text-buzz-accent hover:text-buzz-accent2 font-medium">Sign up free</Link>{" "}
          or{" "}
          <Link href="/login" className="text-buzz-accent hover:text-buzz-accent2 font-medium">sign in</Link>{" "}
          to leave a review.
        </div>
      )}

      {/* Published reviews */}
      {publicReviews.length === 0 && approved.length === 0 ? (
        <p className="text-buzz-mute text-sm">No reviews yet — be the first to share what it's like.</p>
      ) : (
        <div className="flex flex-col gap-4">
          {publicReviews.map((r) => (
            <div key={r.id} className="card p-5">
              <div className="flex items-center gap-3 mb-2">
                <div
                  className="w-10 h-10 rounded-full bg-buzz-surface border border-buzz-border bg-cover bg-center shrink-0 grid place-items-center"
                  style={r.author?.avatar_url ? { backgroundImage: `url(${r.author.avatar_url})` } : undefined}
                >
                  {!r.author?.avatar_url && <span aria-hidden>🙂</span>}
                </div>
                <div className="min-w-0">
                  <div className="font-medium text-sm">{r.author?.display_name || "A parent"}</div>
                  <div className="text-xs"><Stars n={r.rating} /></div>
                </div>
                <div className="ml-auto text-xs text-buzz-mute">
                  {new Date(r.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
                </div>
              </div>
              {r.title && <div className="font-semibold text-sm mb-1">{r.title}</div>}
              {r.body && <p className="text-sm text-buzz-text/90 whitespace-pre-line">{r.body}</p>}
              {(r.images ?? []).length > 0 && (
                <div className="flex flex-wrap gap-2 mt-3">
                  {(r.images ?? [])
                    .sort((a: any, b: any) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
                    .map((img: any, i: number) => (
                      <a key={i} href={img.image_url} target="_blank" rel="noopener" className="block w-20 h-20 rounded-lg bg-buzz-surface bg-cover bg-center border border-buzz-border" style={{ backgroundImage: `url(${img.image_url})` }} aria-label="Review photo" />
                    ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
