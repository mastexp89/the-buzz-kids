"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { createFestival, deleteFestival, type FestivalRow } from "./actions";

export default function FestivalsListClient({ initialFestivals }: { initialFestivals: FestivalRow[] }) {
  const [festivals, setFestivals] = useState(initialFestivals);
  const [showCreate, setShowCreate] = useState(initialFestivals.length === 0);
  const [, startTransition] = useTransition();

  return (
    <div className="flex flex-col gap-4">
      {!showCreate && (
        <button
          type="button"
          onClick={() => setShowCreate(true)}
          className="btn-primary self-start"
        >
          + New festival
        </button>
      )}

      {showCreate && (
        <CreateFestivalCard
          onCancel={() => setShowCreate(false)}
          onCreated={(f) => {
            setFestivals((prev) => [{ ...f, venue_count: 0 }, ...prev]);
            setShowCreate(false);
          }}
        />
      )}

      {festivals.length === 0 && !showCreate && (
        <div className="card p-8 text-center text-buzz-mute">
          No festivals yet. Click <strong>New festival</strong> to add one.
        </div>
      )}

      <div className="grid gap-3">
        {festivals.map((f) => (
          <div key={f.id} className="card p-4 flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <Link
                  href={`/admin/festivals/${f.id}`}
                  className="h-display text-xl hover:text-buzz-accent transition truncate"
                >
                  {f.name}
                </Link>
                {f.published ? (
                  <span className="text-[10px] uppercase tracking-wider text-emerald-400 font-bold">live</span>
                ) : (
                  <span className="text-[10px] uppercase tracking-wider text-buzz-accent font-bold">draft</span>
                )}
              </div>
              <div className="text-xs text-buzz-mute mt-1">
                {formatDate(f.start_date)} — {formatDate(f.end_date)} · {f.venue_count ?? 0} venue{f.venue_count === 1 ? "" : "s"} · /festivals/{f.slug}
              </div>
              {f.tagline && <div className="text-sm text-buzz-mute mt-2">{f.tagline}</div>}
            </div>
            <div className="flex gap-2">
              <Link href={`/admin/festivals/${f.id}`} className="btn-secondary text-xs">Manage</Link>
              {f.published && (
                <Link href={`/festivals/${f.slug}`} target="_blank" className="btn-secondary text-xs">View ↗</Link>
              )}
              <button
                type="button"
                onClick={() => {
                  if (!confirm(`Delete "${f.name}"? This will unlink all venues but won't delete events.`)) return;
                  startTransition(async () => {
                    const r = await deleteFestival(f.id);
                    if ("error" in r) {
                      alert(r.error);
                      return;
                    }
                    setFestivals((prev) => prev.filter((x) => x.id !== f.id));
                  });
                }}
                className="text-xs text-rose-400 hover:text-rose-300"
              >
                Delete
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function CreateFestivalCard({
  onCancel,
  onCreated,
}: {
  onCancel: () => void;
  onCreated: (f: FestivalRow) => void;
}) {
  const [name, setName] = useState("Dundee Music Festival");
  const [startDate, setStartDate] = useState("2026-07-03");
  const [endDate, setEndDate] = useState("2026-07-04");
  const [tagline, setTagline] = useState("2 days, 100+ acts, 45+ venues");
  const [color, setColor] = useState("#e91e63");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const r = await createFestival({
      name,
      start_date: startDate,
      end_date: endDate,
      tagline,
      primary_color: color,
      published: false,
    });
    setBusy(false);
    if ("error" in r) {
      setError(r.error);
      return;
    }
    onCreated({
      id: r.id,
      slug: r.slug,
      name,
      start_date: startDate,
      end_date: endDate,
      tagline,
      primary_color: color,
      hero_image_url: null,
      hero_image_position: "center",
      hero_image_opacity: 0.5,
      hero_image_blur: 24,
      logo_url: null,
      map_image_url: null,
      sponsor_id: null,
      sponsor_name: null,
      sponsor_logo_url: null,
      sponsor_url: null,
      contact_email: null,
      accepting_artists: true,
      sponsor_text: null,
      ticket_url: null,
      description: null,
      act_count_label: null,
      venue_count_label: null,
      // Newly-created festivals default to multi-venue layout (matches the
      // DB default). Admin flips this to 'programme' from the edit screen
      // if/when they want single-park behaviour.
      layout_mode: "multi_venue",
      programme_content: null,
      preview_token: null,
      published: false,
    });
  }

  return (
    <form onSubmit={submit} className="card p-5 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h3 className="h-display text-xl">New festival</h3>
        <button type="button" onClick={onCancel} className="text-xs text-buzz-mute hover:text-buzz-accent">Cancel</button>
      </div>
      <div>
        <label className="label">Name</label>
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} required />
      </div>
      <div className="grid sm:grid-cols-2 gap-3">
        <div>
          <label className="label">Start date</label>
          <input type="date" className="input" value={startDate} onChange={(e) => setStartDate(e.target.value)} required style={{ colorScheme: "dark" }} />
        </div>
        <div>
          <label className="label">End date</label>
          <input type="date" className="input" value={endDate} onChange={(e) => setEndDate(e.target.value)} required style={{ colorScheme: "dark" }} />
        </div>
      </div>
      <div>
        <label className="label">Tagline (optional)</label>
        <input className="input" value={tagline} onChange={(e) => setTagline(e.target.value)} />
      </div>
      <div>
        <label className="label">Theme colour</label>
        <div className="flex items-center gap-2">
          <input type="color" value={color} onChange={(e) => setColor(e.target.value)} className="w-12 h-10 rounded cursor-pointer bg-buzz-surface border border-buzz-border" />
          <input className="input flex-1" value={color} onChange={(e) => setColor(e.target.value)} />
        </div>
      </div>
      {error && <div className="text-sm text-rose-400">{error}</div>}
      <div className="flex gap-2">
        <button type="submit" disabled={busy} className="btn-primary">{busy ? "Creating…" : "Create"}</button>
      </div>
    </form>
  );
}

function formatDate(d: string): string {
  const t = new Date(d);
  if (Number.isNaN(t.getTime())) return d;
  return t.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}
