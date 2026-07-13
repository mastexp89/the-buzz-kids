"use client";

import { useState } from "react";
import Link from "next/link";
import { runFindDeals } from "./actions";
import type { DealSweepResult } from "@/lib/deal-sweep";

export default function RunSweep({ defaultUrls }: { defaultUrls: string[] }) {
  const [urlsText, setUrlsText] = useState(defaultUrls.join("\n"));
  const [busy, setBusy] = useState<null | "dry" | "live">(null);
  const [result, setResult] = useState<DealSweepResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(dry: boolean) {
    setBusy(dry ? "dry" : "live");
    setError(null);
    setResult(null);
    const urls = urlsText.split(/\n+/).map((s) => s.trim()).filter(Boolean);
    try {
      const r = await runFindDeals(urls, dry);
      if (r.error) setError(r.error);
      setResult(r);
    } catch (e: any) {
      setError(e?.message ?? "Sweep failed");
    } finally {
      setBusy(null);
    }
  }

  const fresh = result?.samples.filter((s) => !s.duplicate) ?? [];
  const dupes = result?.samples.filter((s) => s.duplicate) ?? [];

  return (
    <div>
      <label className="text-sm font-medium">Source pages (one URL per line)</label>
      <textarea
        value={urlsText}
        onChange={(e) => setUrlsText(e.target.value)}
        rows={4}
        className="mt-1 w-full rounded-lg border border-buzz-border bg-buzz-bg px-3 py-2 text-sm font-mono"
        placeholder="https://example.com/kids-eat-free"
      />
      <p className="text-[11px] text-buzz-mute mt-1">
        Trusted &ldquo;kids eat free&rdquo; / family-days-out roundups. We extract the deal facts and write our own
        wording — nothing is copied verbatim. Drafts go to the review queue, not live.
      </p>

      <div className="flex gap-2 flex-wrap mt-3">
        <button onClick={() => run(true)} disabled={!!busy} className="btn-secondary text-sm disabled:opacity-50">
          {busy === "dry" ? "Reading…" : "🔍 Preview (no writes)"}
        </button>
        <button onClick={() => run(false)} disabled={!!busy} className="btn-primary text-sm disabled:opacity-50">
          {busy === "live" ? "Finding… (~1 min)" : "▶ Find deals → review queue"}
        </button>
      </div>
      {busy && <p className="text-xs text-buzz-mute mt-2">Reading each page with AI — keep this tab open.</p>}
      {error && <p className="text-sm text-rose-500 mt-2">{error}</p>}

      {result && result.ok && (
        <div className="mt-4 text-sm">
          <p style={{ color: "#3B6D11" }}>
            {result.dry ? (
              <>Preview — read {result.pagesRead}/{result.urlsTried} pages · found <strong>{result.found}</strong> deals
              ({fresh.length} new, {result.duplicates} already have). Run for real to add the new ones to the queue.</>
            ) : (
              <>Read {result.pagesRead}/{result.urlsTried} pages · added <strong>{result.inserted}</strong> new deals to the{" "}
              <Link href="/admin/offers" className="underline">review queue</Link> ({result.duplicates} were already in).</>
            )}
          </p>

          {fresh.length > 0 && (
            <div className="mt-3">
              <p className="font-medium mb-1">🆕 New ({fresh.length})</p>
              <div className="flex flex-col gap-1">
                {fresh.map((s, i) => (
                  <div key={i} className="text-xs border-b border-buzz-border/50 pb-1">
                    <span className="font-medium">{s.category === "food" ? "🍽️" : "🎟️"} {s.title}</span>
                    <span className="text-buzz-mute">
                      {" "}· {s.scope === "national" ? "UK-wide" : `local${s.region ? ` — ${s.region}` : ""}`}
                      {s.ends_on ? ` · ends ${s.ends_on}` : ""}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {dupes.length > 0 && (
            <details className="mt-3">
              <summary className="text-xs text-buzz-mute cursor-pointer hover:text-buzz-accent">
                {dupes.length} already in your list
              </summary>
              <div className="mt-1 flex flex-col gap-0.5">
                {dupes.map((s, i) => (
                  <div key={i} className="text-[11px] text-buzz-mute">{s.title}</div>
                ))}
              </div>
            </details>
          )}

          {result.warnings.length > 0 && (
            <details className="mt-2">
              <summary className="text-xs text-buzz-mute cursor-pointer hover:text-buzz-accent">
                {result.warnings.length} warning{result.warnings.length === 1 ? "" : "s"}
              </summary>
              <ul className="mt-1 text-[11px] text-buzz-mute space-y-1 list-disc pl-4 break-all">
                {result.warnings.map((w, i) => <li key={i}>{w}</li>)}
              </ul>
            </details>
          )}
        </div>
      )}
    </div>
  );
}
