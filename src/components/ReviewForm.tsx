"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import ImageUploader from "@/components/ImageUploader";
import { submitReview } from "@/lib/reviews-actions";

export default function ReviewForm({
  venueId,
  existing,
}: {
  venueId: string;
  existing?: { rating: number; title: string | null; body: string | null; images: string[] } | null;
}) {
  const router = useRouter();
  const [rating, setRating] = useState(existing?.rating ?? 0);
  const [hover, setHover] = useState(0);
  const [title, setTitle] = useState(existing?.title ?? "");
  const [body, setBody] = useState(existing?.body ?? "");
  const [slots, setSlots] = useState<string[]>([
    existing?.images?.[0] ?? "",
    existing?.images?.[1] ?? "",
    existing?.images?.[2] ?? "",
  ]);
  const [pending, start] = useTransition();
  const [res, setRes] = useState<{ ok?: true; error?: string } | null>(null);

  function setSlot(i: number, url: string) {
    setSlots((prev) => prev.map((s, j) => (j === i ? url : s)));
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        setRes(null);
        start(async () => {
          const r = await submitReview({ venueId, rating, title, body, imageUrls: slots.filter(Boolean) });
          setRes(r);
          if (r.ok) router.refresh();
        });
      }}
      className="card p-5 flex flex-col gap-4"
    >
      <h3 className="font-display text-xl uppercase">{existing ? "Update your review" : "Leave a review"}</h3>

      <div>
        <div className="label">Your rating</div>
        <div className="flex gap-1" onMouseLeave={() => setHover(0)}>
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => setRating(n)}
              onMouseEnter={() => setHover(n)}
              aria-label={`${n} star${n > 1 ? "s" : ""}`}
              className="text-3xl leading-none transition"
              style={{ color: n <= (hover || rating) ? "#F9A11B" : "#D6E2EC" }}
            >
              ★
            </button>
          ))}
        </div>
      </div>

      <div>
        <label className="label">Title (optional)</label>
        <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="A brilliant rainy-day spot" maxLength={120} />
      </div>

      <div>
        <label className="label">Your review</label>
        <textarea className="input min-h-[110px]" value={body} onChange={(e) => setBody(e.target.value)} placeholder="What was it like? Anything other parents should know?" maxLength={2000} />
      </div>

      <div>
        <div className="label">Add photos (optional)</div>
        <div className="grid sm:grid-cols-3 gap-3">
          {[0, 1, 2].map((i) => (
            <ImageUploader key={i} folder="reviews" value={slots[i]} onChange={(url) => setSlot(i, url)} maxDimension={1400} />
          ))}
        </div>
      </div>

      {res?.error && <div className="text-sm text-rose-500">{res.error}</div>}
      {res?.ok && (
        <div className="text-sm text-buzz-good">Thanks! Your review will appear once we've had a quick look.</div>
      )}

      <button type="submit" className="btn-primary self-start" disabled={pending || rating === 0}>
        {pending ? "Sending…" : existing ? "Update review" : "Post review"}
      </button>
    </form>
  );
}
