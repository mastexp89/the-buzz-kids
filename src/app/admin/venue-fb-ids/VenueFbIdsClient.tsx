"use client";

import { useState } from "react";
import { setVenueFacebookPageId, searchVenues, type VenueRow } from "./actions";

export default function VenueFbIdsClient({ initial }: { initial: VenueRow[] }) {
  const [rows, setRows] = useState<VenueRow[]>(initial);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);
  const [msg, setMsg] = useState<Record<string, string>>({});

  async function runSearch(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      setRows(await searchVenues(query));
    } finally {
      setBusy(false);
    }
  }

  async function save(id: string, raw: string) {
    setSaving(id);
    try {
      const r = await setVenueFacebookPageId(id, raw);
      if (r.ok) {
        setRows((rs) => rs.map((v) => (v.id === id ? { ...v, facebook_page_id: r.value } : v)));
        setMsg((m) => ({ ...m, [id]: r.value ? "✅ saved" : "cleared" }));
      } else {
        setMsg((m) => ({ ...m, [id]: `⚠ ${r.error}` }));
      }
    } finally {
      setSaving(null);
    }
  }

  return (
    <div>
      <form onSubmit={runSearch} className="flex gap-2 mb-5">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search places by name…"
          className="flex-1 h-10 rounded-lg border border-buzz-border bg-buzz-bg px-3 text-sm"
        />
        <button disabled={busy} className="btn-secondary text-sm disabled:opacity-50">
          {busy ? "Searching…" : "Search"}
        </button>
      </form>

      {rows.length === 0 && (
        <p className="text-sm text-buzz-mute">
          No places matched. Search by name to add an ID for any place.
        </p>
      )}

      <div className="flex flex-col gap-2">
        {rows.map((v) => (
          <div key={v.id} className="rounded-lg border border-buzz-border bg-buzz-card p-3">
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div className="min-w-0">
                <div className="font-medium truncate">
                  {v.name}
                  {v.city ? <span className="text-buzz-mute font-normal"> · {v.city}</span> : null}
                  {v.facebook_page_id && (
                    <span className="ml-2 text-[10px] font-bold bg-buzz-accent/15 text-buzz-accent rounded-full px-2 py-0.5">
                      taggable
                    </span>
                  )}
                </div>
                {v.facebook && (
                  <a href={v.facebook} target="_blank" rel="noopener" className="text-[11px] text-buzz-accent hover:underline break-all">
                    {v.facebook.replace(/^https?:\/\/(www\.)?/, "")} ↗
                  </a>
                )}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <input
                  defaultValue={v.facebook_page_id ?? ""}
                  placeholder="Page ID or URL"
                  className="w-52 h-9 rounded-lg border border-buzz-border bg-buzz-bg px-3 text-sm"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") save(v.id, (e.target as HTMLInputElement).value);
                  }}
                  onBlur={(e) => {
                    const val = e.target.value.trim();
                    if (val !== (v.facebook_page_id ?? "")) save(v.id, val);
                  }}
                />
                {saving === v.id ? (
                  <span className="text-xs text-buzz-mute">saving…</span>
                ) : msg[v.id] ? (
                  <span className="text-xs text-buzz-mute">{msg[v.id]}</span>
                ) : null}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
