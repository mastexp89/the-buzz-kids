"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createEvent } from "./actions";

type City = { id: string; name: string; slug: string };
type Venue = { id: string; name: string; city: { name: string } | null };

export default function EventCreateForm({ cities, venues }: { cities: City[]; venues: Venue[] }) {
  const router = useRouter();
  const [venueId, setVenueId] = useState("");
  const [isFree, setIsFree] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const standalone = !venueId;

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const fd = new FormData(e.currentTarget);
    const r = await createEvent(fd);
    setBusy(false);
    if ("error" in r) { setError(r.error); return; }
    router.push(`/${r.citySlug}/events/${r.eventId}`);
  }

  return (
    <form onSubmit={onSubmit} className="card p-6 grid sm:grid-cols-2 gap-4">
      <div className="sm:col-span-2">
        <label className="label">Event title *</label>
        <input name="title" className="input" required maxLength={160} placeholder="e.g. Broughty Ferry Gala Week" />
      </div>

      <div>
        <label className="label">Start date *</label>
        <input name="start_date" type="date" className="input" required />
      </div>
      <div>
        <label className="label">Start time</label>
        <input name="start_time" type="time" className="input" defaultValue="10:00" />
      </div>
      <div>
        <label className="label">End date <span className="text-buzz-mute font-normal">(optional)</span></label>
        <input name="end_date" type="date" className="input" />
      </div>
      <div>
        <label className="label">End time</label>
        <input name="end_time" type="time" className="input" />
      </div>

      <div className="sm:col-span-2 border-t border-buzz-border pt-4">
        <label className="label">Attach to a place <span className="text-buzz-mute font-normal">(optional)</span></label>
        <select name="venue_id" value={venueId} onChange={(e) => setVenueId(e.target.value)} className="input">
          <option value="">— None (standalone event) —</option>
          {venues.map((v) => (
            <option key={v.id} value={v.id}>{v.name}{v.city?.name ? ` · ${v.city.name}` : ""}</option>
          ))}
        </select>
        <p className="help">Leave as “None” for a town-wide event, then fill in the location below.</p>
      </div>

      {standalone && (
        <>
          <div className="sm:col-span-2">
            <label className="label">Location *</label>
            <input name="location_name" className="input" maxLength={160} placeholder="e.g. Castle Green, Broughty Ferry" />
          </div>
          <div className="sm:col-span-2">
            <label className="label">Area *</label>
            <select name="city_id" className="input" defaultValue="">
              <option value="" disabled>Pick an area…</option>
              {cities.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
        </>
      )}

      <div className="sm:col-span-2 border-t border-buzz-border pt-4 flex items-center gap-2">
        <input id="is_free" name="is_free" type="checkbox" checked={isFree} onChange={(e) => setIsFree(e.target.checked)} className="w-4 h-4 accent-buzz-accent" />
        <label htmlFor="is_free" className="text-sm">Free entry</label>
      </div>
      {!isFree && (
        <div className="sm:col-span-2">
          <label className="label">Price / entry note</label>
          <input name="cover_charge" className="input" maxLength={80} placeholder="e.g. £5 per child" />
        </div>
      )}

      <div className="sm:col-span-2">
        <label className="label">Description</label>
        <textarea name="description" className="input min-h-[110px]" maxLength={1500} placeholder="What's on, who it's for, any need-to-knows." />
      </div>
      <div className="sm:col-span-2">
        <label className="label">Tickets / info link <span className="text-buzz-mute font-normal">(optional)</span></label>
        <input name="ticket_url" type="url" className="input" placeholder="https://…" />
      </div>

      {error && <div className="sm:col-span-2 text-sm text-rose-400">{error}</div>}

      <div className="sm:col-span-2 flex items-center gap-3 pt-1">
        <button type="submit" className="btn-primary" disabled={busy}>
          {busy ? "Adding…" : "Add event"}
        </button>
        <span className="text-xs text-buzz-mute">Goes live straight away on What's On.</span>
      </div>
    </form>
  );
}
