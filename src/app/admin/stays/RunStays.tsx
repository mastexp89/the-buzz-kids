"use client";

import { useState } from "react";
import { runStaysIngest } from "./actions";
import type { StaysIngestResult } from "@/lib/stays-ingest";

const TYPE_LABEL: Record<string, string> = {
  glamping: "⛺ Glamping",
  caravan: "🚐 Caravan parks",
  cottage: "🏡 Cottages",
  hotel: "🏨 Hotels",
};

export default function RunStays({ areas }: { areas: { slug: string; name: string }[] }) {
  const [area, setArea] = useState(areas[0]?.name ?? "");
  const [busy, setBusy] = useState<null | "dry" | "live">(null);
  const [result, setResult] = useState<StaysIngestResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(dry: boolean) {
    setBusy(dry ? "dry" : "live");
    setError(null);
    setResult(null);
    try {
      const r = await runStaysIngest(area, dry);
      if (r.error) setError(r.error);
      setResult(r);
    } catch (e: any) {
      setError(e?.message ?? "Run failed");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div>
      <div className="flex gap-2 flex-wrap items-center">
        <select
          value={area}
          onChange={(e) => setArea(e.target.value)}
          className="h-10 rounded-lg border border-buzz-border bg-buzz-bg px-3 text-sm"
        >
          {areas.map((a) => (
            <option key={a.slug} value={a.name}>{a.name}</option>
          ))}
        </select>
        <button onClick={() => run(true)} disabled={!!busy} className="btn-secondary text-sm disabled:opacity-50">
          {busy === "dry" ? "Checking…" : "🔍 Preview (no writes)"}
        </button>
        <button onClick={() => run(false)} disabled={!!busy} className="btn-primary text-sm disabled:opacity-50">
          {busy === "live" ? "Importing… (~1–2 min)" : "▶ Import stays"}
        </button>
      </div>
      {busy && (
        <p className="text-xs text-buzz-mute mt-2">
          Searching Google for glamping, caravan parks, cottages &amp; hotels in {area} — keep this tab open.
        </p>
      )}
      {error && <p className="text-sm text-rose-500 mt-2">{error}</p>}

      {result && result.ok && (
        <div className="mt-3 text-sm">
          <p style={{ color: "#3B6D11" }}>
            {result.dry ? (
              <>Preview — found <strong>{result.kept}</strong> places to stay in {result.area} ({result.raw} raw · {result.rejected} not accommodation · {result.wrongArea} outside {result.area}). Import to save them.</>
            ) : (
              <>Imported <strong>{result.inserted}</strong> new stays for {result.area} (of {result.kept} found; the rest were already in). Scroll down to review.</>
            )}
          </p>
          <div className="flex gap-2 flex-wrap mt-2">
            {(["glamping", "caravan", "cottage", "hotel"] as const).map((t) => (
              <span key={t} className="text-xs rounded-full border border-buzz-border px-2 py-0.5">
                {TYPE_LABEL[t]}: <strong>{result.counts[t]}</strong>
              </span>
            ))}
          </div>

          {result.dry && result.samples.length > 0 && (
            <details className="mt-3" open>
              <summary className="text-xs text-buzz-mute cursor-pointer hover:text-buzz-accent">
                Show the {result.samples.length} places
              </summary>
              <div className="mt-2 flex flex-col gap-1">
                {(["glamping", "caravan", "cottage", "hotel"] as const).flatMap((t) =>
                  result.samples.filter((s) => s.type === t).map((s, i) => (
                    <div key={`${t}-${i}`} className="text-xs border-b border-buzz-border/50 pb-1">
                      <span className="font-medium">{TYPE_LABEL[t].split(" ")[0]} {s.name}</span>
                      {s.types.length > 1 ? (
                        <span className="text-buzz-mute"> (also {s.types.filter((x) => x !== t).map((x) => TYPE_LABEL[x].split(" ").slice(1).join(" ").toLowerCase()).join(", ")})</span>
                      ) : null}
                      {s.rating ? <span className="text-buzz-mute"> ⭐{s.rating}</span> : null}
                      {s.hasPhoto ? " 📷" : ""}{s.hasSite ? " 🌐" : ""}
                      {s.address ? <span className="text-buzz-mute"> · {s.address}</span> : null}
                    </div>
                  )),
                )}
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
