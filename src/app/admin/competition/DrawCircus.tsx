"use client";

import { useState } from "react";
import { drawCircusWinner, type DrawResult } from "@/lib/competition-actions";

export default function DrawCircus() {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<DrawResult | null>(null);

  async function draw() {
    setBusy(true);
    setResult(await drawCircusWinner());
    setBusy(false);
  }

  return (
    <div>
      <button onClick={draw} disabled={busy} className="btn-primary disabled:opacity-50">
        {busy ? "Drawing…" : "🎲 Draw a winner"}
      </button>
      {result && (
        <p className="mt-3 text-sm" style={{ color: result.ok ? "#3B6D11" : "#c0392b" }}>
          {result.ok
            ? `🎉 Winner: ${result.winner?.name || "(no name)"} — ${result.winner?.email || "no email"} · drawn from ${result.entries} ${result.entries === 1 ? "entry" : "entries"}.`
            : result.message}
        </p>
      )}
    </div>
  );
}
