"use client";

import { useState, useTransition } from "react";
import {
  listPosterBackfillCandidates,
  backfillPosterForEvent,
  type PosterBackfillCandidate,
  type PosterBackfillResult,
} from "./actions";

type Row = PosterBackfillCandidate & {
  state: "idle" | "running" | "ok" | "error";
  message?: string;
};

export default function PosterBackfillPanel() {
  const [pending, start] = useTransition();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [bulkRunning, setBulkRunning] = useState(false);

  function load() {
    setError(null);
    start(async () => {
      try {
        const data = await listPosterBackfillCandidates();
        setRows(
          data.map((r) => ({ ...r, state: "idle" as const })),
        );
      } catch (e: any) {
        setError(e?.message ?? "Failed to load candidates");
      }
    });
  }

  async function runOne(idx: number) {
    if (!rows) return;
    const eventId = rows[idx].id;
    setRows((prev) => prev?.map((r, i) => i === idx ? { ...r, state: "running" } : r) ?? null);
    let result: PosterBackfillResult;
    try {
      result = await backfillPosterForEvent(eventId);
    } catch (e: any) {
      setRows((prev) => prev?.map((r, i) =>
        i === idx ? { ...r, state: "error", message: e?.message ?? "failed" } : r,
      ) ?? null);
      return;
    }
    setRows((prev) => prev?.map((r, i) =>
      i === idx
        ? "ok" in result
          ? { ...r, state: "ok", message: "Saved" }
          : { ...r, state: "error", message: result.error }
        : r,
    ) ?? null);
  }

  async function runAll() {
    if (!rows || bulkRunning) return;
    setBulkRunning(true);
    for (let i = 0; i < rows.length; i++) {
      // Skip ones already done
      if (rows[i].state === "ok") continue;
      // eslint-disable-next-line no-await-in-loop
      await runOne(i);
    }
    setBulkRunning(false);
  }

  const pendingCount = rows?.filter((r) => r.state === "idle").length ?? 0;
  const okCount = rows?.filter((r) => r.state === "ok").length ?? 0;
  const errCount = rows?.filter((r) => r.state === "error").length ?? 0;

  return (
    <section className="card p-5 mt-10">
      <h2 className="h-display text-2xl mb-1">🖼️ Backfill poster images</h2>
      <p className="text-buzz-mute text-sm mb-4 max-w-2xl">
        Re-downloads the source image saved on each existing extracted event and
        re-hosts it on our Supabase Storage bucket. Facebook CDN URLs expire after
        a few hours, so a lot of older imports will fail (404) — that's expected.
        Website-sourced images should mostly succeed.
      </p>

      {!rows && (
        <button
          type="button"
          onClick={load}
          disabled={pending}
          className="btn-secondary"
        >
          {pending ? "Loading…" : "Find candidates"}
        </button>
      )}

      {error && <div className="text-rose-400 text-sm mt-3">{error}</div>}

      {rows && (
        <>
          <div className="flex flex-wrap items-center gap-3 mb-4">
            <span className="text-sm text-buzz-mute">
              {rows.length} candidate{rows.length === 1 ? "" : "s"}
              {okCount > 0 && ` · ${okCount} saved`}
              {errCount > 0 && ` · ${errCount} failed`}
            </span>
            <button
              type="button"
              onClick={runAll}
              disabled={bulkRunning || pendingCount === 0}
              className="btn-primary"
            >
              {bulkRunning ? "Running…" : `Run all (${pendingCount})`}
            </button>
            <button
              type="button"
              onClick={load}
              disabled={pending || bulkRunning}
              className="btn-secondary"
            >
              Refresh
            </button>
          </div>

          {rows.length === 0 ? (
            <div className="text-buzz-mute text-sm">
              Nothing to backfill — every extracted event already has a persisted poster
              (or no source image).
            </div>
          ) : (
            <div className="grid gap-1.5 max-h-[500px] overflow-auto">
              {rows.map((r, i) => (
                <div
                  key={r.id}
                  className="flex items-center gap-3 px-3 py-2 rounded-md bg-buzz-surface border border-buzz-border text-sm"
                >
                  <div className="flex-1 min-w-0">
                    <div className="truncate">{r.title}</div>
                    <div className="text-xs text-buzz-mute truncate">
                      {r.source ?? "—"} · {r.imageUrl ?? "(no url)"}
                    </div>
                  </div>
                  <div className="text-xs w-24 text-right">
                    {r.state === "idle" && <span className="text-buzz-mute">pending</span>}
                    {r.state === "running" && <span className="text-buzz-accent">running…</span>}
                    {r.state === "ok" && <span className="text-emerald-400">✓ {r.message}</span>}
                    {r.state === "error" && <span className="text-rose-400" title={r.message}>✗ {r.message?.slice(0, 30)}</span>}
                  </div>
                  <button
                    type="button"
                    onClick={() => runOne(i)}
                    disabled={r.state === "running" || bulkRunning}
                    className="chip"
                  >
                    Retry
                  </button>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </section>
  );
}
