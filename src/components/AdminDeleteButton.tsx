"use client";

// Inline admin-only delete control shown on the public browse views (places,
// events, deals/food) so an admin can prune bad entries while browsing the
// live site — no trip to /admin needed. The underlying server actions each
// re-check admin auth, so this is safe even if the button somehow renders for
// a non-admin (it won't — callers gate on isAdmin).

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteVenueAdmin } from "@/app/admin/actions";
import { deleteEventAdmin } from "@/app/admin/events/actions";
import { deleteOffer } from "@/app/admin/offers/actions";

type Kind = "place" | "event" | "offer";
const NOUN: Record<Kind, string> = { place: "place", event: "event", offer: "deal" };

export default function AdminDeleteButton({
  kind,
  id,
  name,
  className,
}: {
  kind: Kind;
  id: string;
  name?: string;
  className?: string;
}) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  function onClick(e: React.MouseEvent) {
    // These buttons often sit inside a card that is itself a link — don't
    // navigate when the admin clicks delete.
    e.preventDefault();
    e.stopPropagation();
    const what = name ? `“${name}”` : `this ${NOUN[kind]}`;
    const extra = kind === "place" ? "\n\nThis also deletes all of its events." : "";
    if (!confirm(`Delete ${what} permanently?${extra}\n\nThis cannot be undone.`)) return;
    setErr(null);
    start(async () => {
      const r =
        kind === "place" ? await deleteVenueAdmin(id)
        : kind === "event" ? await deleteEventAdmin(id)
        : await deleteOffer(id);
      if (r && "error" in r && r.error) { setErr(r.error); return; }
      router.refresh();
    });
  }

  return (
    <div className={className}>
      <button
        type="button"
        onClick={onClick}
        disabled={busy}
        className="w-full inline-flex items-center justify-center gap-1 rounded-lg border border-rose-600/40 bg-rose-600/10 text-rose-600 hover:bg-rose-600 hover:text-white transition text-xs font-semibold py-1.5 disabled:opacity-60"
        title={`Admin: delete this ${NOUN[kind]}`}
      >
        {busy ? "Deleting…" : `🗑 Delete ${NOUN[kind]}`}
      </button>
      {err && <p className="text-[11px] text-rose-500 mt-1">{err}</p>}
    </div>
  );
}
