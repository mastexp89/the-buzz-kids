"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  parseFixturesText,
  bulkCreateFromFixtures,
  type ParsedFixtureEvent,
} from "./actions";

type Draft = ParsedFixtureEvent & { selected: boolean };

const EXAMPLE = `Live Sport Showing This Week
Monday 11th
⚽️ Napoli v Bologna 19:45
⚽️ Tottenham v Leeds 20:00
Tuesday 12th
⚽️ Celtic v Dundee 19:45
⛳️ PGA Championship 14:00`;

function toLocalTimeLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function PasteFixturesClient({ venueId }: { venueId: string }) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [parsing, startParse] = useTransition();
  const [creating, startCreate] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  function parse() {
    setError(null);
    setInfo(null);
    setDrafts([]);
    startParse(async () => {
      const res = await parseFixturesText(venueId, text);
      if ("error" in res) {
        setError(res.error);
        return;
      }
      if (res.events.length === 0) {
        setError("AI couldn't find any events in that text. Try pasting more context.");
        return;
      }
      setDrafts(res.events.map((e) => ({ ...e, selected: true })));
    });
  }

  function updateDraft(i: number, patch: Partial<Draft>) {
    setDrafts((ds) => ds.map((d, idx) => (idx === i ? { ...d, ...patch } : d)));
  }

  function create() {
    const selected = drafts.filter((d) => d.selected);
    if (selected.length === 0) {
      setError("Tick at least one event to create.");
      return;
    }
    setError(null);
    setInfo(null);
    startCreate(async () => {
      const res = await bulkCreateFromFixtures(
        venueId,
        selected.map((d) => ({
          title: d.title,
          starts_at: d.starts_at,
          ends_at: d.ends_at,
          description: d.description,
          genres: d.genres,
        })),
      );
      if ("error" in res) {
        setError(res.error);
        return;
      }
      const replacedNote = res.replacedAggregations > 0
        ? ` (replaced ${res.replacedAggregations} previous sports-day ${res.replacedAggregations === 1 ? "row" : "rows"} for the same day to avoid duplicates)`
        : "";
      setInfo(
        `✓ Created ${res.created} ${res.created === 1 ? "event" : "events"}. They're live on your venue page.${replacedNote}`,
      );
      setDrafts([]);
      setText("");
      router.refresh();
    });
  }

  const selectedCount = drafts.filter((d) => d.selected).length;

  return (
    <div className="flex flex-col gap-4">
      <div className="card p-4 flex flex-col gap-3">
        <label className="label">Paste fixtures or event list</label>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={EXAMPLE}
          className="input font-mono text-sm min-h-[200px]"
          spellCheck={false}
        />
        <div className="flex flex-wrap gap-2 items-center">
          <button
            type="button"
            onClick={parse}
            disabled={parsing || creating || !text.trim()}
            className="btn-primary"
          >
            {parsing ? "Parsing…" : "✨ Parse with AI"}
          </button>
          {drafts.length > 0 && (
            <button
              type="button"
              onClick={() => {
                setDrafts([]);
                setError(null);
                setInfo(null);
              }}
              className="btn-ghost text-sm"
            >
              Clear preview
            </button>
          )}
          <p className="text-xs text-buzz-mute ml-auto">
            Sports multi-match days collapse into one event automatically.
          </p>
        </div>
        {error && <div className="text-sm text-rose-400">{error}</div>}
        {info && <div className="text-sm text-emerald-400">{info}</div>}
      </div>

      {drafts.length > 0 && (
        <>
          <div className="flex items-center justify-between flex-wrap gap-3">
            <p className="eyebrow">Preview · {drafts.length} {drafts.length === 1 ? "event" : "events"}</p>
            <div className="flex items-center gap-2">
              <label className="inline-flex items-center gap-2 text-xs cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={drafts.every((d) => d.selected)}
                  onChange={(e) =>
                    setDrafts((ds) => ds.map((d) => ({ ...d, selected: e.target.checked })))
                  }
                  className="accent-buzz-accent"
                />
                Select all
              </label>
              <button
                type="button"
                onClick={create}
                disabled={creating || selectedCount === 0}
                className="btn-primary"
              >
                {creating
                  ? "Creating…"
                  : `Create ${selectedCount} ${selectedCount === 1 ? "event" : "events"}`}
              </button>
            </div>
          </div>

          <ul className="card divide-y divide-buzz-border/60">
            {drafts.map((d, i) => (
              <li key={i} className="p-4 flex flex-col gap-2">
                <div className="flex items-start gap-3">
                  <input
                    type="checkbox"
                    checked={d.selected}
                    onChange={(e) => updateDraft(i, { selected: e.target.checked })}
                    className="accent-buzz-accent mt-1.5"
                    aria-label={`Include ${d.title}`}
                  />
                  <div className="flex-1 min-w-0 flex flex-col gap-1">
                    <input
                      type="text"
                      value={d.title}
                      onChange={(e) => updateDraft(i, { title: e.target.value })}
                      className="input font-medium"
                      placeholder="Event title"
                    />
                    <div className="text-xs text-buzz-mute flex flex-wrap gap-2 items-center">
                      <span>📅 {toLocalTimeLabel(d.starts_at)}</span>
                      {d.type === "sports_screening" && (
                        <span className="text-[10px] uppercase tracking-wider text-buzz-accent">
                          sports
                        </span>
                      )}
                      {d.confidence < 0.7 && (
                        <span
                          className="text-[10px] uppercase tracking-wider text-amber-400"
                          title="AI wasn't confident about this one — double-check before creating"
                        >
                          low confidence
                        </span>
                      )}
                    </div>
                    <textarea
                      value={d.description}
                      onChange={(e) => updateDraft(i, { description: e.target.value })}
                      className="input text-sm min-h-[80px] font-mono"
                      placeholder="Description (visible to fans on the event page)"
                    />
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
