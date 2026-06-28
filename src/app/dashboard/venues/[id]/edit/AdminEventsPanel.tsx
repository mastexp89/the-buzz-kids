"use client";

// Admin-only side panel listing every event at this venue with a delete button.
// Shown on the venue edit page beside VenueForm. Hard-deletes via adminDeleteEvent.

import { useState, useTransition } from "react";
import Link from "next/link";
import { adminDeleteEvent } from "./admin-actions";

type Event = {
  id: string;
  title: string;
  start_time: string;
  status: string | null;
  auto_imported_from: string | null;
};

export default function AdminEventsPanel({
  venueId,
  events,
}: {
  venueId: string;
  events: Event[];
}) {
  const [list, setList] = useState<Event[]>(events);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  async function onDelete(eventId: string, title: string) {
    if (!confirm(`Permanently delete "${title}"? This can't be undone.`)) return;
    setBusyId(eventId);
    setError(null);
    const r = await adminDeleteEvent({ eventId, venueId });
    setBusyId(null);
    if ("error" in r) {
      setError(r.error);
      return;
    }
    startTransition(() => {
      setList((prev) => prev.filter((e) => e.id !== eventId));
    });
  }

  const upcoming = list.filter((e) => new Date(e.start_time).getTime() >= Date.now());
  const past = list.filter((e) => new Date(e.start_time).getTime() < Date.now());

  return (
    <div className="card p-4 flex flex-col gap-3">
      <div>
        <p className="eyebrow text-buzz-accent text-[10px] mb-1">Admin · Events</p>
        <h3 className="font-display text-lg uppercase">Manage events</h3>
        <p className="text-xs text-buzz-mute mt-1">Hard-delete duplicates / wrong rows. {list.length} total.</p>
      </div>

      {error && <div className="text-xs text-rose-400">{error}</div>}

      {upcoming.length > 0 && (
        <div>
          <div className="eyebrow text-[10px] mb-1">Upcoming ({upcoming.length})</div>
          <ul className="flex flex-col gap-1">
            {upcoming.map((e) => (
              <EventRow key={e.id} event={e} venueId={venueId} busy={busyId === e.id} onDelete={onDelete} />
            ))}
          </ul>
        </div>
      )}

      {past.length > 0 && (
        <div>
          <div className="eyebrow text-[10px] mb-1">Past ({past.length})</div>
          <ul className="flex flex-col gap-1 opacity-70">
            {past.map((e) => (
              <EventRow key={e.id} event={e} venueId={venueId} busy={busyId === e.id} onDelete={onDelete} />
            ))}
          </ul>
        </div>
      )}

      {list.length === 0 && (
        <div className="text-xs text-buzz-mute text-center py-4">No events.</div>
      )}
    </div>
  );
}

function EventRow({
  event,
  venueId,
  busy,
  onDelete,
}: {
  event: Event;
  venueId: string;
  busy: boolean;
  onDelete: (id: string, title: string) => void;
}) {
  return (
    <li className="rounded-lg border border-buzz-border/60 px-2 py-2 flex items-start gap-2 text-xs">
      <div className="flex-1 min-w-0">
        <div className="font-medium truncate">{event.title}</div>
        <div className="text-[10px] text-buzz-mute mt-0.5">
          {formatWhen(event.start_time)}
          {event.status && event.status !== "approved" && <> · <span className="text-buzz-accent">{event.status}</span></>}
          {event.auto_imported_from && <> · {event.auto_imported_from}</>}
        </div>
      </div>
      <div className="flex flex-col gap-1 shrink-0">
        <Link
          href={`/dashboard/venues/${venueId}/events/${event.id}/edit`}
          className="text-[10px] text-buzz-mute hover:text-buzz-accent text-right"
        >
          edit
        </Link>
        <button
          type="button"
          onClick={() => onDelete(event.id, event.title)}
          disabled={busy}
          className="text-[10px] text-rose-400 hover:text-rose-300 disabled:opacity-50 text-right"
        >
          {busy ? "deleting…" : "delete"}
        </button>
      </div>
    </li>
  );
}

function formatWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}
