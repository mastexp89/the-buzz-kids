"use client";

import { useState } from "react";
import { reportOffer } from "@/lib/offers-actions";

export default function OfferReportButton({ offerId }: { offerId: string }) {
  const [state, setState] = useState<"idle" | "busy" | "done">("idle");

  if (state === "done") {
    return <span className="text-xs text-buzz-mute">✓ Thanks — we&apos;ll check it.</span>;
  }

  return (
    <button
      type="button"
      onClick={async () => {
        setState("busy");
        await reportOffer(offerId);
        setState("done");
      }}
      disabled={state === "busy"}
      className="text-xs text-buzz-mute hover:text-buzz-accent underline underline-offset-2 transition"
    >
      {state === "busy" ? "…" : "Not on anymore?"}
    </button>
  );
}
