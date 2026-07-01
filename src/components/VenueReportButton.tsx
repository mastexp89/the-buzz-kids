"use client";

import { useState } from "react";
import { reportVenue } from "@/lib/venue-report-actions";

const REASONS = ["Closed down", "Moved location", "Wrong details", "Something else"];

export default function VenueReportButton({ venueId }: { venueId: string }) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<"idle" | "busy" | "done">("idle");

  if (state === "done") {
    return <span className="text-xs text-buzz-mute">✓ Thanks — we&apos;ll check it.</span>;
  }
  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-xs text-buzz-mute hover:text-buzz-accent underline underline-offset-2 transition"
      >
        ⚠️ Report an issue (closed / moved / wrong info)
      </button>
    );
  }
  return (
    <div className="text-xs text-buzz-mute">
      <span className="block mb-1.5">What&apos;s wrong with this place?</span>
      <div className="flex flex-wrap gap-1.5">
        {REASONS.map((r) => (
          <button
            key={r}
            type="button"
            disabled={state === "busy"}
            onClick={async () => { setState("busy"); await reportVenue(venueId, r); setState("done"); }}
            className="rounded-full border border-buzz-border px-2.5 py-1 hover:border-buzz-accent hover:text-buzz-accent transition disabled:opacity-50"
          >
            {r}
          </button>
        ))}
      </div>
    </div>
  );
}
