"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  setSuggestionStatus, deleteSuggestion,
  draftFromSuggestion, createFromSuggestion,
} from "./actions";
import type { ParsedSuggestion } from "@/lib/extraction";

type Suggestion = {
  id: string;
  target_type: "venue" | "event" | "new_place";
  target_id: string | null;
  target_name: string | null;
  city_slug: string | null;
  reason: string | null;
  details: string | null;
  contact_name: string | null;
  contact_email: string | null;
  is_owner: boolean;
  status: "new" | "reviewed" | "done";
  image_url: string | null;
  created_at: string;
};

const TYPE_META: Record<Suggestion["target_type"], { label: string; emoji: string }> = {
  venue: { label: "Place", emoji: "📍" },
  event: { label: "Event", emoji: "🎟️" },
  new_place: { label: "New place", emoji: "✨" },
};

// Where in admin to go to action this suggestion. Venue/new-place → the main
// admin search (by name); event → the events search.
function adminHref(s: Suggestion): string | null {
  const q = encodeURIComponent(s.target_name ?? "");
  if (s.target_type === "event") return `/admin/events?q=${q}`;
  if (s.target_name) return `/admin?q=${q}`;
  return null;
}


type Area = { id: string; name: string; slug: string };

// Reads a submission into editable fields so it can be approved in one go,
// instead of being retyped by hand. Nothing is saved until "Create".
function DraftPanel({ id, citySlug, onDone }: { id: string; citySlug: string | null; onDone: () => void }) {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);
  const [d, setD] = useState<ParsedSuggestion | null>(null);
  const [areas, setAreas] = useState<Area[]>([]);
  const [cityId, setCityId] = useState("");

  async function load() {
    setLoading(true); setErr(null); setOkMsg(null);
    try {
      const r = await draftFromSuggestion(id);
      if ("error" in r) { setErr(r.error); return; }
      setD(r.draft); setAreas(r.areas);
      const guess =
        r.areas.find((a) => citySlug && a.slug === citySlug) ??
        r.areas.find((a) => r.draft.town && a.name.toLowerCase() === r.draft.town.toLowerCase());
      setCityId(guess?.id ?? "");
    } catch (e: any) { setErr(e?.message ?? "Failed"); }
    finally { setLoading(false); }
  }

  async function create() {
    if (!d) return;
    setSaving(true); setErr(null);
    try {
      const r = await createFromSuggestion({
        suggestionId: id, kind: d.kind, title: d.title, description: d.description,
        cityId, locationName: [d.venue_name, d.address].filter(Boolean).join(", ") || null,
        address: d.address, date: d.date, startTime: d.start_time, endTime: d.end_time,
        isFree: d.is_free === true, price: d.price,
      });
      if (r.error) { setErr(r.error); return; }
      setOkMsg(d.kind === "place" ? "Place created (unapproved — add a photo)" : "Event created");
      onDone();
    } catch (e: any) { setErr(e?.message ?? "Failed"); }
    finally { setSaving(false); }
  }

  const set = (k: keyof ParsedSuggestion) => (e: any) =>
    setD((prev) => (prev ? { ...prev, [k]: e.target.value || null } as ParsedSuggestion : prev));
  const field = "h-9 w-full rounded-lg border border-buzz-border bg-buzz-bg px-2.5 text-sm";

  if (!d) {
    return (
      <div className="mt-2">
        <button onClick={load} disabled={loading} className="btn-secondary text-xs disabled:opacity-50">
          {loading ? "Reading…" : "✨ Turn into a draft"}
        </button>
        {err && <p className="text-xs text-rose-500 mt-1">{err}</p>}
      </div>
    );
  }

  return (
    <div className="mt-3 rounded-lg border border-buzz-accent/40 bg-buzz-surface/60 p-3">
      <div className="flex items-center gap-2 mb-2">
        <select value={d.kind} onChange={set("kind")} className="h-8 rounded-lg border border-buzz-border bg-buzz-bg px-2 text-xs">
          <option value="event">📅 Event</option>
          <option value="place">📍 Place</option>
        </select>
        {d.missing.length > 0 && (
          <span className="text-[11px] text-amber-600">Not stated: {d.missing.join(", ")}</span>
        )}
      </div>

      <div className="grid sm:grid-cols-2 gap-2">
        <label className="text-[11px] text-buzz-mute sm:col-span-2">Title
          <input value={d.title} onChange={set("title")} className={field} />
        </label>
        <label className="text-[11px] text-buzz-mute sm:col-span-2">Where
          <input value={[d.venue_name, d.address].filter(Boolean).join(", ")}
            onChange={(e) => setD({ ...d, venue_name: e.target.value, address: null })} className={field} />
        </label>
        <label className="text-[11px] text-buzz-mute">Area
          <select value={cityId} onChange={(e) => setCityId(e.target.value)} className={field}>
            <option value="">— pick —</option>
            {areas.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </label>
        {d.kind === "event" && (
          <>
            <label className="text-[11px] text-buzz-mute">Date
              <input type="date" value={d.date ?? ""} onChange={set("date")} className={field} />
            </label>
            <label className="text-[11px] text-buzz-mute">Starts
              <input type="time" value={d.start_time ?? ""} onChange={set("start_time")} className={field} />
            </label>
            <label className="text-[11px] text-buzz-mute">Ends
              <input type="time" value={d.end_time ?? ""} onChange={set("end_time")} className={field} />
            </label>
          </>
        )}
        <label className="text-[11px] text-buzz-mute sm:col-span-2">Description
          <input value={d.description ?? ""} onChange={set("description")} className={field} />
        </label>
      </div>

      <div className="flex items-center gap-2 mt-3 flex-wrap">
        <button onClick={create} disabled={saving} className="btn-primary text-xs disabled:opacity-50">
          {saving ? "Creating…" : d.kind === "place" ? "Create place" : "Create event"}
        </button>
        <button onClick={() => setD(null)} className="btn-secondary text-xs">Cancel</button>
        {okMsg && <span className="text-xs" style={{ color: "#3B6D11" }}>{okMsg}</span>}
        {err && <span className="text-xs text-rose-500">{err}</span>}
      </div>
    </div>
  );
}

export default function SuggestionsClient({ suggestions }: { suggestions: Suggestion[] }) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [, start] = useTransition();

  const open = suggestions.filter((s) => s.status !== "done");
  const done = suggestions.filter((s) => s.status === "done");

  function act(id: string, fn: () => Promise<unknown>) {
    setBusyId(id);
    start(async () => {
      await fn();
      setBusyId(null);
      router.refresh();
    });
  }

  const row = (s: Suggestion) => {
    const meta = TYPE_META[s.target_type];
    const href = adminHref(s);
    const when = new Date(s.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
    return (
      <li key={s.id} className="p-4 flex flex-col gap-2">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[10px] uppercase tracking-wider bg-buzz-surface border border-buzz-border rounded px-1.5 py-0.5">
                {meta.emoji} {meta.label}
              </span>
              {s.is_owner && (
                <span className="text-[10px] uppercase tracking-wider bg-amber-500/15 text-amber-600 rounded px-1.5 py-0.5" title="Says they run this place">
                  ✋ Owner
                </span>
              )}
              {s.reason && <span className="text-xs text-buzz-mute">{s.reason}</span>}
              <span className="text-xs text-buzz-mute/70">· {when}</span>
            </div>
            <div className="font-medium mt-1">
              {href ? (
                <Link href={href} className="hover:text-buzz-accent transition">{s.target_name ?? "—"}</Link>
              ) : (
                s.target_name ?? "—"
              )}
            </div>
          </div>
          <div className="flex gap-2 shrink-0">
            {s.status !== "done" ? (
              <button onClick={() => act(s.id, () => setSuggestionStatus(s.id, "done"))} disabled={busyId === s.id} className="btn-primary text-xs disabled:opacity-60">
                {busyId === s.id ? "…" : "Mark done"}
              </button>
            ) : (
              <button onClick={() => act(s.id, () => setSuggestionStatus(s.id, "new"))} disabled={busyId === s.id} className="btn-secondary text-xs disabled:opacity-60">
                {busyId === s.id ? "…" : "Reopen"}
              </button>
            )}
            <button
              onClick={() => { if (confirm("Delete this suggestion?")) act(s.id, () => deleteSuggestion(s.id)); }}
              disabled={busyId === s.id}
              className="btn-danger text-xs disabled:opacity-60"
            >
              Delete
            </button>
          </div>
        </div>

        {s.details && <p className="text-sm text-buzz-text/90 whitespace-pre-line">{s.details}</p>}

        {s.image_url && (
          <a href={s.image_url} target="_blank" rel="noreferrer" className="inline-block">
            <img
              src={s.image_url}
              alt="Attached poster / photo"
              className="h-28 rounded-lg border border-buzz-border object-contain bg-buzz-surface hover:border-buzz-accent transition"
            />
          </a>
        )}

        {s.status !== "done" && (
          <DraftPanel id={s.id} citySlug={s.city_slug} onDone={() => router.refresh()} />
        )}

        {(s.contact_name || s.contact_email) && (
          <p className="text-xs text-buzz-mute">
            ✉️ {[s.contact_name, s.contact_email].filter(Boolean).join(" · ")}
            {s.contact_email && (
              <> — <a href={`mailto:${s.contact_email}`} className="text-buzz-accent hover:underline">reply</a></>
            )}
          </p>
        )}
      </li>
    );
  };

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h2 className="font-display text-xl uppercase mb-2">
          To action <span className="text-buzz-mute text-sm font-normal">({open.length})</span>
        </h2>
        {open.length === 0 ? (
          <div className="card p-6 text-buzz-mute text-sm">Nothing waiting. ✨</div>
        ) : (
          <ul className="card divide-y divide-buzz-border/60">{open.map(row)}</ul>
        )}
      </div>

      {done.length > 0 && (
        <details className="group">
          <summary className="cursor-pointer list-none flex items-center gap-2 mb-3 hover:text-buzz-accent transition">
            <span className="inline-block transition-transform group-open:rotate-90 text-buzz-mute">▶</span>
            <h2 className="font-display text-xl uppercase inline">
              Done <span className="text-buzz-mute text-sm font-normal">({done.length})</span>
            </h2>
          </summary>
          <ul className="card divide-y divide-buzz-border/60">{done.map(row)}</ul>
        </details>
      )}
    </div>
  );
}
