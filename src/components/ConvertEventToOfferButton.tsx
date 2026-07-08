"use client";

// Admin-only: convert a What's On event into a standing deal on the Food /
// Deals tab (for scraped "kids swim for £1"-type items that aren't really
// dated events). Sits next to the admin delete button on event cards.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { convertEventToOffer } from "@/app/admin/offers/actions";

export default function ConvertEventToOfferButton({
  eventId,
  eventTitle,
}: {
  eventId: string;
  eventTitle: string;
}) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function convert(category: "food" | "days-out") {
    if (!confirm(
      `Turn "${eventTitle}" into a ${category === "food" ? "Food" : "Days out"} deal?\n\n` +
      "It moves to the Deals/Food tab (attached to its place, poster kept) and is removed from What's On.",
    )) return;
    setError(null);
    start(async () => {
      const r = await convertEventToOffer(eventId, category);
      if (r.error) { setError(r.error); return; }
      setDone(true);
      router.refresh();
    });
  }

  if (done) return <span className="text-xs text-emerald-600">✓ Moved to deals</span>;

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="w-full text-xs rounded-lg border border-buzz-border bg-buzz-surface/50 text-buzz-mute hover:border-buzz-accent hover:text-buzz-accent transition px-2 py-1.5"
      >
        🎟️ Make it a deal…
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex gap-1.5">
        <button
          type="button"
          disabled={busy}
          onClick={() => convert("food")}
          className="flex-1 text-xs rounded-lg border border-buzz-border bg-buzz-surface/50 hover:border-buzz-accent hover:text-buzz-accent transition px-2 py-1.5 disabled:opacity-50"
        >
          {busy ? "…" : "🍽️ Food deal"}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => convert("days-out")}
          className="flex-1 text-xs rounded-lg border border-buzz-border bg-buzz-surface/50 hover:border-buzz-accent hover:text-buzz-accent transition px-2 py-1.5 disabled:opacity-50"
        >
          {busy ? "…" : "🎟️ Days out"}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-xs text-buzz-mute hover:text-buzz-text px-1"
          aria-label="Cancel"
        >
          ✕
        </button>
      </div>
      {error && <span className="text-xs text-rose-500">{error}</span>}
    </div>
  );
}
