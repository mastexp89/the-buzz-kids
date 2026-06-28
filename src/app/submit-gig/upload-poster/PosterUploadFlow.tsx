"use client";

import { useMemo, useState } from "react";
import PosterReviewPanel from "@/components/PosterReviewPanel";

type Venue = {
  id: string;
  name: string;
  slug: string;
  city: { name: string } | null;
};

export default function PosterUploadFlow({ venues }: { venues: Venue[] }) {
  const [picked, setPicked] = useState<Venue | null>(null);
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return venues.slice(0, 8);
    return venues
      .filter(
        (v) =>
          v.name.toLowerCase().includes(q) ||
          (v.city?.name ?? "").toLowerCase().includes(q),
      )
      .slice(0, 12);
  }, [query, venues]);

  if (picked) {
    return (
      <div className="flex flex-col gap-4">
        <div className="card p-4 flex items-center gap-3 flex-wrap">
          <div className="flex-1 min-w-0">
            <div className="text-xs text-buzz-mute">Venue</div>
            <div className="font-display text-xl uppercase truncate">{picked.name}</div>
            <div className="text-xs text-buzz-mute">{picked.city?.name ?? "—"}</div>
          </div>
          <button
            type="button"
            onClick={() => {
              setPicked(null);
              setQuery("");
            }}
            className="btn-secondary"
          >
            Change venue
          </button>
        </div>

        <PosterReviewPanel venueId={picked.id} venueName={picked.name} />
      </div>
    );
  }

  return (
    <div className="card p-5 flex flex-col gap-3">
      <label className="label">Which venue is the gig at?</label>
      <input
        className="input"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Start typing the venue name…"
        autoFocus
      />
      <div className="flex flex-col gap-1">
        {filtered.length === 0 ? (
          <p className="text-buzz-mute text-sm py-2">
            No matches. Make sure the venue is on The Buzz Guide — if it isn't, use the{" "}
            <a href="/submit-gig" className="text-buzz-accent">manual form</a> to suggest it.
          </p>
        ) : (
          filtered.map((v) => (
            <button
              key={v.id}
              type="button"
              onClick={() => setPicked(v)}
              className="text-left rounded-md px-3 py-2 hover:bg-buzz-surface border border-transparent hover:border-buzz-border transition"
            >
              <div className="font-medium">{v.name}</div>
              <div className="text-xs text-buzz-mute">{v.city?.name ?? "—"}</div>
            </button>
          ))
        )}
      </div>
    </div>
  );
}
