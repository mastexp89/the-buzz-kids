"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteEventAdmin } from "../events/actions";

type Venue = {
  id: string; name: string; slug: string;
  image_url: string | null; cover_photo_url: string | null; logo_url: string | null; google_photo_url: string | null;
  city: { name: string; slug: string } | null;
} | null;

type Ev = {
  id: string;
  title: string;
  description: string | null;
  start_time: string;
  end_time: string | null;
  image_url: string | null;
  is_free: boolean;
  cover_charge: string | null;
  status: string | null;
  cancelled: boolean;
  location_name: string | null;
  venue: Venue;
  city: { name: string; slug: string } | null;
  categories: { name: string; slug: string }[];
};

type City = { name: string; slug: string; active: boolean };

function photoOf(e: Ev): string | null {
  return (
    e.image_url ||
    e.venue?.cover_photo_url ||
    e.venue?.image_url ||
    e.venue?.logo_url ||
    e.venue?.google_photo_url ||
    null
  );
}

function fmtDate(start: string, end: string | null): string {
  const opts: Intl.DateTimeFormatOptions = { timeZone: "Europe/London", weekday: "short", day: "numeric", month: "short" };
  const s = new Date(start).toLocaleDateString("en-GB", opts);
  const t = new Date(start).toLocaleTimeString("en-GB", { timeZone: "Europe/London", hour: "numeric", minute: "2-digit" });
  if (end) {
    const sameDay = new Date(start).toDateString() === new Date(end).toDateString();
    if (!sameDay) {
      const e = new Date(end).toLocaleDateString("en-GB", opts);
      return `${s} → ${e}`;
    }
  }
  return `${s} · ${t}`;
}

export default function EventsManageClient({ events, cities }: { events: Ev[]; cities: City[] }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [area, setArea] = useState("");
  const [when, setWhen] = useState<"upcoming" | "all">("upcoming");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
    return events.filter((e) => {
      const evCitySlug = e.venue?.city?.slug ?? e.city?.slug;
      if (area && evCitySlug !== area) return false;
      if (needle && !e.title.toLowerCase().includes(needle)) return false;
      if (when === "upcoming") {
        const end = e.end_time ? new Date(e.end_time) : new Date(e.start_time);
        if (end < todayStart) return false;
      }
      return true;
    });
  }, [events, q, area, when]);

  function destroy(e: Ev) {
    if (!confirm(`Delete "${e.title}" permanently? This cannot be undone.`)) return;
    setError(null);
    setBusyId(e.id);
    start(async () => {
      const r = await deleteEventAdmin(e.id);
      setBusyId(null);
      if (r?.error) setError(r.error);
      else router.refresh();
    });
  }

  return (
    <div>
      <div className="flex flex-col sm:flex-row gap-2 sm:items-center mb-4">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by title…" className="input flex-1" />
        <select value={area} onChange={(e) => setArea(e.target.value)} className="input sm:w-52">
          <option value="">All areas</option>
          {cities.map((c) => <option key={c.slug} value={c.slug}>{c.name}{!c.active ? " (hidden)" : ""}</option>)}
        </select>
        <select value={when} onChange={(e) => setWhen(e.target.value as any)} className="input sm:w-40">
          <option value="upcoming">Upcoming</option>
          <option value="all">All (incl. past)</option>
        </select>
      </div>

      <p className="text-sm text-buzz-mute mb-4">
        Showing <strong className="text-buzz-text">{filtered.length}</strong> of {events.length} events.
      </p>
      {error && <div className="text-sm text-rose-400 mb-3">{error}</div>}

      <div className="grid gap-3">
        {filtered.map((e) => {
          const photo = photoOf(e);
          const placeLabel = e.venue?.name ?? e.location_name ?? "—";
          const areaName = e.venue?.city?.name ?? e.city?.name;
          const price = e.is_free ? "Free" : e.cover_charge || null;
          const citySlug = e.venue?.city?.slug ?? e.city?.slug ?? "dundee";
          return (
            <div key={e.id} className="card p-3 flex flex-col sm:flex-row gap-3">
              <div
                className="w-full h-32 sm:w-32 sm:h-24 shrink-0 rounded-lg bg-buzz-surface grid place-items-center overflow-hidden"
                style={photo ? { backgroundImage: `url(${photo})`, backgroundSize: "cover", backgroundPosition: "center" } : undefined}
              >
                {!photo && <span className="text-2xl opacity-50">📅</span>}
              </div>

              <div className="min-w-0 flex-1">
                <div className="flex items-start gap-2 flex-wrap">
                  <h3 className="font-display text-lg uppercase leading-tight">{e.title}</h3>
                  {e.cancelled && <span className="text-[10px] uppercase tracking-wide bg-rose-500/15 text-rose-500 px-1.5 py-0.5 rounded">Cancelled</span>}
                  {e.status && e.status !== "approved" && <span className="text-[10px] uppercase tracking-wide bg-amber-500/15 text-amber-600 px-1.5 py-0.5 rounded">{e.status}</span>}
                  {!e.venue && <span className="text-[10px] uppercase tracking-wide bg-buzz-accent/15 text-buzz-accent px-1.5 py-0.5 rounded">Standalone</span>}
                </div>
                <div className="text-xs text-buzz-accent font-medium mt-0.5">{fmtDate(e.start_time, e.end_time)}</div>
                <div className="text-xs text-buzz-mute">
                  {placeLabel}{areaName ? ` · ${areaName}` : ""}{price ? ` · ${price}` : ""}
                </div>
                {e.description && <p className="text-sm text-buzz-mute line-clamp-2 mt-1">{e.description}</p>}
              </div>

              <div className="flex sm:flex-col gap-2 shrink-0 sm:w-28">
                <Link href={`/${citySlug}/events/${e.id}`} target="_blank" className="btn-ghost text-center text-sm flex-1 sm:flex-none">View</Link>
                <Link href={`/dashboard/events/${e.id}/edit`} className="btn-secondary text-center text-sm flex-1 sm:flex-none">Edit</Link>
                <button onClick={() => destroy(e)} disabled={pending && busyId === e.id} className="btn-danger text-sm flex-1 sm:flex-none">
                  {pending && busyId === e.id ? "…" : "Delete"}
                </button>
              </div>
            </div>
          );
        })}
        {filtered.length === 0 && (
          <div className="card p-8 text-center text-buzz-mute">No events match those filters.</div>
        )}
      </div>
    </div>
  );
}
