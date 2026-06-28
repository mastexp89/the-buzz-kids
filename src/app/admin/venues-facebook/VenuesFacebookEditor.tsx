"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { saveVenueFacebook, findFacebookCandidate, deleteVenueFromAdmin } from "./actions";

type Row = {
  id: string;
  name: string;
  slug: string;
  facebook: string | null;
  website: string | null;
  approved: boolean;
  citySlug: string | null;
  cityName: string | null;
  lastScrape: string | null;
};

type Filter = "all" | "missing" | "has";

type Source = "website" | "search" | "google" | null;

type RowState = {
  // current value in the input (may be unsaved)
  value: string;
  // last successfully saved value (matches DB)
  saved: string;
  // unconfirmed suggestion from auto-find — shown for approve/skip
  candidate: string | null;
  candidateSource: Source;
  // ui status
  status: "idle" | "saving" | "saved" | "error" | "finding" | "notfound";
  errorMsg?: string;
};

const BULK_CONCURRENCY = 3;

export default function VenuesFacebookEditor({ initialRows }: { initialRows: Row[] }) {
  const [rows, setRows] = useState(initialRows);
  // Ids of venues currently being deleted, so we can show "Deleting…" and
  // prevent a double-click from firing two requests.
  const [deletingIds, setDeletingIds] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState<Filter>("missing");
  const [search, setSearch] = useState("");
  const [, startTransition] = useTransition();

  const [bulkRunning, setBulkRunning] = useState(false);
  const [bulkProgress, setBulkProgress] = useState({ done: 0, total: 0, found: 0 });
  const cancelBulkRef = useRef(false);

  const [rowState, setRowState] = useState<Record<string, RowState>>(() => {
    const init: Record<string, RowState> = {};
    for (const r of initialRows) {
      const v = r.facebook ?? "";
      init[r.id] = {
        value: v,
        saved: v,
        candidate: null,
        candidateSource: null,
        status: "idle",
      };
    }
    return init;
  });

  function updateLocal(id: string, value: string) {
    setRowState((s) => ({
      ...s,
      [id]: {
        ...s[id],
        value,
        status: s[id].status === "error" ? "error" : "idle",
      },
    }));
  }

  function commit(id: string) {
    const cur = rowState[id];
    if (!cur) return;
    const trimmed = cur.value.trim();
    if (trimmed === (cur.saved ?? "").trim()) return; // no change

    setRowState((s) => ({ ...s, [id]: { ...s[id], status: "saving" } }));
    startTransition(async () => {
      const res = await saveVenueFacebook(id, trimmed);
      setRowState((s) => {
        const prev = s[id];
        if (!prev) return s;
        if ("error" in res) {
          return { ...s, [id]: { ...prev, status: "error", errorMsg: res.error } };
        }
        const saved = res.value ?? "";
        return { ...s, [id]: { ...prev, saved, value: saved, status: "saved" } };
      });
    });
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>, id: string) {
    if (e.key === "Enter") {
      e.preventDefault();
      (e.target as HTMLInputElement).blur();
    }
    if (e.key === "Escape") {
      setRowState((s) => ({
        ...s,
        [id]: { ...s[id], value: s[id].saved, status: "idle" },
      }));
      (e.target as HTMLInputElement).blur();
    }
  }

  // Find a candidate FB URL for the venue. Doesn't save — just stages the
  // suggestion for the admin to approve or skip.
  async function findOne(id: string): Promise<{ found: boolean }> {
    setRowState((s) => ({ ...s, [id]: { ...s[id], status: "finding" } }));
    const res = await findFacebookCandidate(id);
    setRowState((s) => {
      const prev = s[id];
      if (!prev) return s;
      if ("error" in res) {
        return { ...s, [id]: { ...prev, status: "error", errorMsg: res.error } };
      }
      const value = res.value ?? null;
      const source = res.source ?? null;
      if (!value) {
        return {
          ...s,
          [id]: { ...prev, candidate: null, candidateSource: null, status: "notfound" },
        };
      }
      return {
        ...s,
        [id]: { ...prev, candidate: value, candidateSource: source, status: "idle" },
      };
    });
    return { found: !("error" in res) && !!res.value };
  }

  // Approve the staged candidate — saves it and clears the suggestion.
  function approveCandidate(id: string) {
    const cur = rowState[id];
    if (!cur?.candidate) return;
    const candidate = cur.candidate;
    setRowState((s) => ({
      ...s,
      [id]: { ...s[id], value: candidate, status: "saving", candidate: null, candidateSource: null },
    }));
    startTransition(async () => {
      const res = await saveVenueFacebook(id, candidate);
      setRowState((s) => {
        const prev = s[id];
        if (!prev) return s;
        if ("error" in res) {
          return {
            ...s,
            [id]: {
              ...prev,
              status: "error",
              errorMsg: res.error,
              // restore candidate so admin can retry
              candidate,
              candidateSource: cur.candidateSource,
            },
          };
        }
        const saved = res.value ?? "";
        return { ...s, [id]: { ...prev, saved, value: saved, status: "saved" } };
      });
    });
  }

  function skipCandidate(id: string) {
    setRowState((s) => ({
      ...s,
      [id]: { ...s[id], candidate: null, candidateSource: null, status: "notfound" },
    }));
  }

  function deleteRow(id: string, name: string) {
    if (deletingIds.has(id)) return;
    if (
      !confirm(
        `Delete "${name}"? This removes the venue and ALL its events, claims and extraction history. This cannot be undone.`,
      )
    ) {
      return;
    }
    setDeletingIds((s) => {
      const next = new Set(s);
      next.add(id);
      return next;
    });
    startTransition(async () => {
      const res = await deleteVenueFromAdmin(id);
      if ("error" in res) {
        alert(`Couldn't delete: ${res.error}`);
        setDeletingIds((s) => {
          const next = new Set(s);
          next.delete(id);
          return next;
        });
        return;
      }
      // Drop the row + its state locally so the UI reflects the delete
      // without a full page reload.
      setRows((rs) => rs.filter((r) => r.id !== id));
      setRowState((s) => {
        const { [id]: _gone, ...rest } = s;
        return rest;
      });
      setDeletingIds((s) => {
        const next = new Set(s);
        next.delete(id);
        return next;
      });
    });
  }

  async function runBulkFind() {
    const eligible = rows.filter((r) => {
      const st = rowState[r.id];
      if (!st) return false;
      if (st.saved.trim()) return false; // already has FB URL
      if (st.candidate) return false; // already has a pending suggestion
      if (st.status === "finding" || st.status === "saving") return false;
      return true; // every missing row, with or without website
    });
    if (eligible.length === 0) return;

    cancelBulkRef.current = false;
    setBulkRunning(true);
    setBulkProgress({ done: 0, total: eligible.length, found: 0 });

    let cursor = 0;
    let foundCount = 0;
    let doneCount = 0;

    async function worker() {
      while (true) {
        if (cancelBulkRef.current) return;
        const i = cursor++;
        if (i >= eligible.length) return;
        try {
          const { found } = await findOne(eligible[i].id);
          if (found) foundCount++;
        } catch {
          /* per-row error already reflected in rowState */
        }
        doneCount++;
        setBulkProgress({ done: doneCount, total: eligible.length, found: foundCount });
      }
    }

    await Promise.all(
      Array.from({ length: Math.min(BULK_CONCURRENCY, eligible.length) }, () => worker()),
    );
    setBulkRunning(false);
  }

  function cancelBulkFind() {
    cancelBulkRef.current = true;
  }

  // Approve every currently-pending candidate at once.
  function approveAllPending() {
    const ids = Object.entries(rowState)
      .filter(([, st]) => !!st.candidate)
      .map(([id]) => id);
    for (const id of ids) approveCandidate(id);
  }

  const eligibleForBulk = useMemo(
    () =>
      rows.filter((r) => {
        const st = rowState[r.id];
        if (!st) return false;
        return !st.saved.trim() && !st.candidate;
      }).length,
    [rows, rowState],
  );

  const pendingCandidateCount = useMemo(
    () => Object.values(rowState).filter((st) => !!st.candidate).length,
    [rowState],
  );

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (q && !r.name.toLowerCase().includes(q) && !(r.cityName ?? "").toLowerCase().includes(q)) {
        return false;
      }
      const savedFb = rowState[r.id]?.saved.trim();
      const hasFb = !!savedFb;
      if (filter === "missing" && hasFb) return false;
      if (filter === "has" && !hasFb) return false;
      return true;
    });
  }, [rows, rowState, filter, search]);

  return (
    <div>
      <div className="flex flex-wrap gap-3 items-center mb-4">
        <div className="flex gap-1">
          {(["missing", "all", "has"] as Filter[]).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              className={
                "px-3 py-1.5 rounded-full text-sm transition " +
                (filter === f
                  ? "bg-buzz-accent text-buzz-bg font-medium"
                  : "bg-buzz-card text-buzz-mute hover:text-buzz-fg")
              }
            >
              {f === "missing" && "Missing"}
              {f === "all" && "All"}
              {f === "has" && "Has URL"}
            </button>
          ))}
        </div>
        <input
          type="search"
          placeholder="Search by venue or city…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="input flex-1 min-w-[200px]"
        />
      </div>

      <div className="card p-4 mb-4 flex flex-wrap items-center gap-3">
        <div className="flex-1 min-w-0">
          <div className="font-medium text-sm">
            ✨ Auto-find Facebook URLs
          </div>
          <div className="text-xs text-buzz-mute">
            Tries the venue's website footer first → DuckDuckGo "site:facebook.com Venue City"
            → Google via Apify (~£0.004 / query) when DDG misses. Each hit is shown as a
            suggestion for you to approve or skip; nothing saves without your click.
            {!bulkRunning && eligibleForBulk > 0 && <> {eligibleForBulk} eligible.</>}
            {bulkRunning && (
              <> Progress: {bulkProgress.done}/{bulkProgress.total} · {bulkProgress.found} found.</>
            )}
          </div>
        </div>
        {pendingCandidateCount > 0 && !bulkRunning && (
          <button
            type="button"
            onClick={approveAllPending}
            className="btn-secondary"
            title="Save every currently-pending suggestion at once"
          >
            ✓ Use all {pendingCandidateCount}
          </button>
        )}
        {!bulkRunning ? (
          <button
            type="button"
            onClick={runBulkFind}
            disabled={eligibleForBulk === 0}
            className="btn-primary disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Search {eligibleForBulk}
          </button>
        ) : (
          <button type="button" onClick={cancelBulkFind} className="btn-secondary">
            Stop
          </button>
        )}
      </div>

      {visible.length === 0 ? (
        <div className="card p-8 text-center text-buzz-mute">
          No venues match this filter.
        </div>
      ) : (
        <ul className="card divide-y divide-buzz-border/60">
          {visible.map((r) => {
            const st = rowState[r.id];
            const dirty = st.value.trim() !== (st.saved ?? "").trim();
            const hasCandidate = !!st.candidate;
            return (
              <li
                key={r.id}
                className="p-3 sm:p-4 flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3"
              >
                <div className="min-w-0 sm:w-56 sm:shrink-0">
                  <div className="font-medium truncate select-all cursor-text">
                    {r.name}
                    {r.cityName && (
                      <span className="text-buzz-mute"> {r.cityName.toLowerCase()}</span>
                    )}
                  </div>
                  <div className="text-xs text-buzz-mute truncate flex gap-2">
                    {r.website ? (
                      <a
                        href={
                          /^https?:\/\//i.test(r.website) ? r.website : `https://${r.website}`
                        }
                        target="_blank"
                        rel="noreferrer"
                        className="hover:text-buzz-accent truncate"
                      >
                        🌐 site
                      </a>
                    ) : (
                      <span className="text-buzz-mute/60">no site</span>
                    )}
                    {!r.approved && <span className="text-orange-400">pending</span>}
                  </div>
                </div>

                {hasCandidate ? (
                  <div className="flex-1 flex flex-wrap items-center gap-2 bg-buzz-accent/5 border border-buzz-accent/40 rounded-lg p-2">
                    <span className="text-[10px] uppercase tracking-wider text-buzz-mute shrink-0">
                      {st.candidateSource === "website"
                        ? "From site"
                        : st.candidateSource === "google"
                        ? "From Google"
                        : "From search"}
                    </span>
                    <a
                      href={st.candidate!}
                      target="_blank"
                      rel="noreferrer"
                      className="text-xs text-buzz-accent hover:underline truncate flex-1 min-w-0"
                      title="Open this Facebook page in a new tab to verify"
                    >
                      {st.candidate}
                    </a>
                    <button
                      type="button"
                      onClick={() => approveCandidate(r.id)}
                      className="btn-primary text-xs px-3 py-1 shrink-0"
                      title="Save this URL"
                    >
                      ✓ Use
                    </button>
                    <button
                      type="button"
                      onClick={() => skipCandidate(r.id)}
                      className="btn-ghost text-xs px-3 py-1 shrink-0"
                      title="Discard this suggestion"
                    >
                      ✗ Skip
                    </button>
                  </div>
                ) : (
                  <input
                    type="text"
                    value={st.value}
                    onChange={(e) => updateLocal(r.id, e.target.value)}
                    onBlur={() => commit(r.id)}
                    onKeyDown={(e) => handleKeyDown(e, r.id)}
                    placeholder="https://www.facebook.com/…"
                    className="input flex-1"
                    spellCheck={false}
                    autoComplete="off"
                  />
                )}

                <button
                  type="button"
                  onClick={() => findOne(r.id)}
                  disabled={
                    st.status === "finding" || hasCandidate || !!st.saved.trim()
                  }
                  title={
                    st.saved.trim()
                      ? "Already has a FB URL"
                      : hasCandidate
                      ? "Suggestion already shown — Use or Skip first"
                      : "Look up this venue's Facebook page"
                  }
                  className="btn-ghost text-xs shrink-0 disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  {st.status === "finding" ? "…" : "🔎 Find"}
                </button>

                <div className="text-xs w-24 text-right shrink-0">
                  {st.status === "finding" && <span className="text-buzz-mute">Searching…</span>}
                  {st.status === "saving" && <span className="text-buzz-mute">Saving…</span>}
                  {st.status === "saved" && !dirty && (
                    <span className="text-green-400">✓ Saved</span>
                  )}
                  {st.status === "notfound" && (
                    <span className="text-buzz-mute">No match</span>
                  )}
                  {st.status === "idle" && dirty && (
                    <span className="text-buzz-mute">Unsaved</span>
                  )}
                  {st.status === "idle" && !dirty && st.saved && !hasCandidate && (
                    <span className="text-buzz-mute">·</span>
                  )}
                  {st.status === "error" && (
                    <span className="text-red-400" title={st.errorMsg ?? ""}>
                      ✗ Error
                    </span>
                  )}
                </div>

                <button
                  type="button"
                  onClick={() => deleteRow(r.id, r.name)}
                  disabled={deletingIds.has(r.id)}
                  title="Delete this venue and all its events"
                  className="text-xs shrink-0 px-2 py-1 rounded text-rose-400 hover:bg-rose-500/10 transition disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {deletingIds.has(r.id) ? "…" : "🗑 Delete"}
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <p className="text-xs text-buzz-mute mt-4">
        Tip: paste then click anywhere outside the box (or press Enter) to save. Press Esc to revert
        an unsaved edit. Click any suggested URL to open the Facebook page in a new tab so you can
        check it before clicking Use. Use cancels and Skip discards.
      </p>
    </div>
  );
}
