"use client";

// Admin-only "Pull events from Facebook now" button on the venue
// dashboard page. Fires the /api/admin/venues/[id]/pull-facebook route
// which runs the same scrape-extract-dedupe-insert pipeline the
// nightly cron does, just for this one venue.
//
// Shows live state ("Scanning Facebook…") and an inline summary on
// completion. Only renders when both isAdmin AND the venue has a
// facebook URL set — the API will refuse either way, but no point
// showing a button that's always going to error.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

type Result = {
  ok?: boolean;
  posts?: number;
  events?: number;
  skipped?: number;
  error?: string;
};

export default function PullFacebookButton({
  venueId,
  facebookUrl,
  isAdmin,
}: {
  venueId: string;
  facebookUrl: string | null;
  isAdmin: boolean;
}) {
  const router = useRouter();
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [, startRefresh] = useTransition();

  // Hide for non-admins entirely so venue owners aren't tempted to spam
  // the Apify-billed endpoint.
  if (!isAdmin) return null;

  async function run() {
    if (!facebookUrl) return;
    setRunning(true);
    setResult(null);
    try {
      const res = await fetch(`/api/admin/venues/${venueId}/pull-facebook`, {
        method: "POST",
      });
      const json: Result = await res.json();
      setResult(json);
      // Refresh the server-rendered venue page so any newly-inserted
      // events appear in the "Upcoming gigs" list immediately.
      startRefresh(() => router.refresh());
    } catch (e: any) {
      setResult({ error: e?.message ?? String(e) });
    } finally {
      setRunning(false);
    }
  }

  if (!facebookUrl) {
    return (
      <span
        className="btn-secondary opacity-50 cursor-not-allowed"
        title="Add a Facebook URL to this venue first"
      >
        📘 Pull from FB (no URL)
      </span>
    );
  }

  return (
    <div className="flex flex-col gap-1 items-end">
      <button
        type="button"
        onClick={run}
        disabled={running}
        className="btn-secondary"
        title="Run the FB scraper just for this venue. Costs ~$0.01 of Apify."
      >
        {running ? "📘 Scanning Facebook…" : "📘 Pull from FB"}
      </button>
      {result && (
        <p
          className={
            "text-xs " +
            (result.error
              ? "text-rose-400"
              : (result.events ?? 0) > 0
                ? "text-emerald-400"
                : "text-buzz-mute")
          }
        >
          {result.error
            ? `Error: ${result.error}`
            : (result.events ?? 0) > 0
              ? `Added ${result.events} event${result.events === 1 ? "" : "s"} from ${result.posts} post${result.posts === 1 ? "" : "s"}` +
                ((result.skipped ?? 0) > 0 ? ` · ${result.skipped} duplicate skipped` : "")
              : `Scanned ${result.posts ?? 0} post${result.posts === 1 ? "" : "s"} — no new events found`}
        </p>
      )}
    </div>
  );
}
