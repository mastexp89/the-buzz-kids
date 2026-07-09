"use client";

import { useState } from "react";
import { drawWinner, type DrawResult } from "./actions";

export default function DrawButtons({ labels }: { labels: string[] }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, DrawResult>>({});

  async function run(label: string) {
    setBusy(label);
    const res = await drawWinner(label);
    setResults((r) => ({ ...r, [label]: res }));
    setBusy(null);
  }

  if (labels.length === 0) return <p className="text-sm text-buzz-mute">No draw-entry prizes configured.</p>;

  return (
    <div className="flex flex-col gap-3">
      {labels.map((label) => {
        const r = results[label];
        return (
          <div key={label} className="rounded-lg border border-buzz-border bg-buzz-card p-3">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <span className="font-medium">{label}</span>
              <button
                onClick={() => run(label)}
                disabled={busy === label}
                className="btn-secondary text-sm disabled:opacity-50"
              >
                {busy === label ? "Drawing…" : "🎲 Draw a winner"}
              </button>
            </div>
            {r && (
              <p className="mt-2 text-sm" style={{ color: r.ok ? "#3B6D11" : "#c0392b" }}>
                {r.ok
                  ? `🎉 Winner: ${r.winner} — drawn from ${r.entries} confirmed ${r.entries === 1 ? "entry" : "entries"} across ${r.entrants} ${r.entrants === 1 ? "person" : "people"}.`
                  : r.message}
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}
