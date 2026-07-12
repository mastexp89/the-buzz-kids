"use client";

import { useState } from "react";
import { runEnrichmentNow } from "./actions";

export default function AutoEnrichNow() {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      const r = await runEnrichmentNow();
      if (!r.ok) setErr(r.error ?? "Something went wrong.");
      else setMsg(`Enriched ${r.filled} of ${r.processed} scanned · ${r.remaining} still to go. Click again to keep going.`);
    } catch {
      setErr("Run failed (it may have timed out — click again to continue).");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card p-4 mb-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <p className="text-sm font-medium">⚡ Auto-fill now (no review)</p>
          <p className="text-xs text-buzz-mute">
            Fills photos, hours, website, phone, rating &amp; address from Google for a big batch — no picking. Runs
            for up to ~4 min per click; keep clicking to blast through the backlog.
          </p>
        </div>
        <button onClick={run} disabled={busy} className="btn-primary text-sm disabled:opacity-50 whitespace-nowrap">
          {busy ? "Filling… (up to 4 min)" : "⚡ Auto-fill a batch"}
        </button>
      </div>
      {msg && <p className="text-sm mt-3" style={{ color: "#3B6D11" }}>{msg}</p>}
      {err && <p className="text-sm mt-3 text-rose-500">{err}</p>}
    </div>
  );
}
