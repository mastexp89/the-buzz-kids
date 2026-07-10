"use client";

import { useState } from "react";
import { runAggregatorNow } from "./actions";
import type { AggregatorRunResult } from "@/lib/aggregator-ingest";

export default function RunNow() {
  const [busy, setBusy] = useState<null | "dry" | "live">(null);
  const [result, setResult] = useState<AggregatorRunResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(dry: boolean) {
    setBusy(dry ? "dry" : "live");
    setError(null);
    setResult(null);
    try {
      setResult(await runAggregatorNow(dry));
    } catch (e: any) {
      setError(e?.message ?? "Run failed");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div>
      <div className="flex gap-2 flex-wrap">
        <button onClick={() => run(true)} disabled={!!busy} className="btn-secondary text-sm disabled:opacity-50">
          {busy === "dry" ? "Checking…" : "🔍 Dry run (no writes)"}
        </button>
        <button onClick={() => run(false)} disabled={!!busy} className="btn-primary text-sm disabled:opacity-50">
          {busy === "live" ? "Running…" : "▶ Run now (into queue)"}
        </button>
      </div>
      {error && <p className="text-sm text-rose-500 mt-2">{error}</p>}
      {result && (
        <p className="text-sm mt-3" style={{ color: "#3B6D11" }}>
          {result.dry ? "Dry run — " : ""}swept {result.sourcesRun} feed{result.sourcesRun === 1 ? "" : "s"} ·
          {" "}{result.detailUrlsFound} listings ({result.skippedSeen} already seen, {result.newUrls} new) ·
          {" "}processed {result.processed} → <strong>{result.events} event{result.events === 1 ? "" : "s"}</strong>
          {" "}+ <strong>{result.places} place{result.places === 1 ? "" : "s"}</strong>
          {result.dry ? " would be added." : " added to the review queue."}
          {result.warnings.length > 0 && <> · {result.warnings.length} warning{result.warnings.length === 1 ? "" : "s"}</>}
        </p>
      )}
    </div>
  );
}
