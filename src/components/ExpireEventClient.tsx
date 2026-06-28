"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { expireEventNow } from "@/app/admin/actions";

export default function ExpireEventClient({
  eventId,
  eventTitle,
  hasEndTime,
}: {
  eventId: string;
  eventTitle: string;
  hasEndTime: boolean;
}) {
  const router = useRouter();
  const [busy, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleClick() {
    const message = hasEndTime
      ? `"${eventTitle}" already has an end time. Expire it now anyway? This sets end_time to right now so it disappears from listings immediately.`
      : `Mark "${eventTitle}" as finished? Sets end_time to right now so it disappears from listings.`;
    if (!confirm(message)) return;
    setError(null);
    startTransition(async () => {
      const r = await expireEventNow(eventId);
      if ("error" in r) {
        setError(r.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="card p-3 mt-6 border-buzz-mute/30 bg-buzz-card text-xs flex items-center gap-3">
      <span className="text-base" aria-hidden>🛠️</span>
      <div className="flex-1 min-w-0">
        <div className="font-medium text-buzz-mute">Admin tools</div>
        {error && <div className="text-rose-400 mt-0.5">{error}</div>}
      </div>
      <button
        type="button"
        onClick={handleClick}
        disabled={busy}
        className="text-xs px-3 py-1.5 rounded-full bg-buzz-bg border border-buzz-border hover:border-buzz-accent text-buzz-fg transition disabled:opacity-50"
      >
        {busy ? "Expiring…" : "⏰ Mark as finished"}
      </button>
    </div>
  );
}
