"use client";

import { useState, useTransition } from "react";
import { approvePendingGig, rejectPendingGig } from "./pending-actions";

type PendingGig = {
  id: string;
  title: string;
  start_time: string;
  cover_charge: string | null;
  description: string | null;
  image_url: string | null;
  submitter: { email: string | null; display_name: string | null } | null;
};

export default function PendingGigsList({ gigs, venueId }: { gigs: PendingGig[]; venueId: string }) {
  return (
    <ul className="card divide-y divide-buzz-border/60 border-buzz-accent/40">
      {gigs.map((g) => <Row key={g.id} gig={g} venueId={venueId} />)}
    </ul>
  );
}

function Row({ gig, venueId }: { gig: PendingGig; venueId: string }) {
  const [pending, start] = useTransition();
  const [done, setDone] = useState<"approved" | "rejected" | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (done) {
    return (
      <li className="px-4 py-3 text-sm text-buzz-mute">
        {done === "approved" ? "✅ Approved" : "Rejected"}: {gig.title}
      </li>
    );
  }

  const when = new Date(gig.start_time);
  const dateLabel = when.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
  const timeLabel = when.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });

  return (
    <li className="px-4 py-4">
      <div className="flex items-start gap-3">
        {gig.image_url ? (
          <div
            className="w-14 h-14 rounded-lg bg-buzz-surface shrink-0"
            style={{ backgroundImage: `url(${gig.image_url})`, backgroundSize: "cover", backgroundPosition: "center" }}
          />
        ) : (
          <div className="w-14 h-14 rounded-lg bg-buzz-surface border border-buzz-border grid place-items-center text-2xl shrink-0">🎤</div>
        )}
        <div className="flex-1 min-w-0">
          <div className="text-xs text-buzz-accent font-bold uppercase tracking-wider">
            {dateLabel} · {timeLabel}
          </div>
          <div className="font-display text-lg uppercase truncate mt-0.5">{gig.title}</div>
          {gig.cover_charge && <div className="text-xs text-buzz-mute mt-0.5">{gig.cover_charge}</div>}
          {gig.submitter && (
            <div className="text-xs text-buzz-mute mt-1">
              From {gig.submitter.display_name ?? gig.submitter.email ?? "an artist"}
            </div>
          )}
          {gig.description && (
            <p className="text-sm text-buzz-text/80 mt-2 line-clamp-3 whitespace-pre-line">
              {gig.description}
            </p>
          )}
        </div>
        <div className="flex flex-col gap-1.5 items-end shrink-0">
          <button
            type="button"
            disabled={pending}
            className="btn-primary !py-1.5 !px-3 text-xs"
            onClick={() => start(async () => {
              const r = await approvePendingGig(gig.id, venueId);
              if (r?.error) setError(r.error);
              else setDone("approved");
            })}
          >
            {pending ? "…" : "Approve"}
          </button>
          <button
            type="button"
            disabled={pending}
            className="btn-danger !py-1.5 !px-3 text-xs"
            onClick={() => {
              if (!confirm(`Reject "${gig.title}"? The artist will be told it didn't make the cut.`)) return;
              start(async () => {
                const r = await rejectPendingGig(gig.id, venueId);
                if (r?.error) setError(r.error);
                else setDone("rejected");
              });
            }}
          >
            Reject
          </button>
        </div>
      </div>
      {error && <div className="text-xs text-rose-400 mt-2">{error}</div>}
    </li>
  );
}
