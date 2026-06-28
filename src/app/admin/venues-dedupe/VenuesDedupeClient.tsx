"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  findVenueDuplicates,
  mergeVenues,
  type DupeGroup,
  type DupeVenue,
} from "./actions";

type City = { slug: string; name: string; active: boolean };

export default function VenuesDedupeClient({ cities }: { cities: City[] }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [scope, setScope] = useState<string>("all");
  const [phase, setPhase] = useState<"idle" | "scanning" | "reviewing">("idle");
  const [groups, setGroups] = useState<DupeGroup[]>([]);
  // For each group key, which venue id is selected as the winner.
  const [winners, setWinners] = useState<Record<string, string>>({});
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [resolved, setResolved] = useState<Set<string>>(new Set());
  const [info, setInfo] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  function scan() {
    setError(null);
    setPhase("scanning");
    setGroups([]);
    setWinners({});
    setResolved(new Set());
    setInfo({});
    startTransition(async () => {
      const res = await findVenueDuplicates(scope === "all" ? undefined : scope);
      if ("error" in res) {
        setError(res.error);
        setPhase("idle");
        return;
      }
      setGroups(res.groups);
      const initialWinners: Record<string, string> = {};
      for (const g of res.groups) initialWinners[g.key] = g.venues[0].id;
      setWinners(initialWinners);
      setPhase("reviewing");
    });
  }

  function merge(g: DupeGroup) {
    const winnerId = winners[g.key];
    if (!winnerId) return;
    const losers = g.venues.filter((v) => v.id !== winnerId);
    const winnerName = g.venues.find((v) => v.id === winnerId)?.name ?? "?";
    if (
      !confirm(
        `Merge ${losers.length} venue(s) into "${winnerName}"?\n\n` +
          `Loser(s): ${losers.map((l) => l.name).join(", ")}\n\n` +
          `Their events, extractions, page-views and festival links will move to the keeper.\n` +
          `Old URLs will 301 to the keeper. The loser rows are deleted.`,
      )
    ) {
      return;
    }
    setBusyKey(g.key);
    startTransition(async () => {
      const res = await mergeVenues(winnerId, losers.map((l) => l.id));
      setBusyKey(null);
      if ("error" in res) {
        setInfo((m) => ({ ...m, [g.key]: `Error: ${res.error}` }));
        return;
      }
      setResolved((s) => new Set(s).add(g.key));
      setInfo((m) => ({
        ...m,
        [g.key]:
          `✓ Merged · moved ${res.moved.events} events, ${res.moved.extractions} extractions, ` +
          `${res.moved.pageViews} page-views, ${res.moved.festivalLinks} festival links · ` +
          `dropped ${res.deletedClaims} claims · created ${res.redirectsCreated} slug redirects`,
      }));
      router.refresh();
    });
  }

  return (
    <div>
      {/* Scope picker + scan button */}
      <div className="card p-5 mb-6 flex flex-wrap items-end gap-3">
        <div className="flex-1 min-w-[200px]">
          <label className="label">Scope</label>
          <select
            className="input"
            value={scope}
            onChange={(e) => setScope(e.target.value)}
            disabled={phase === "scanning"}
          >
            <option value="all">All cities</option>
            {cities.map((c) => (
              <option key={c.slug} value={c.slug}>
                {c.name}
                {c.active ? "" : " — hidden"}
              </option>
            ))}
          </select>
        </div>
        <button
          type="button"
          onClick={scan}
          disabled={phase === "scanning"}
          className="btn-primary"
        >
          {phase === "scanning" ? "Scanning…" : "🔍 Find duplicates"}
        </button>
      </div>

      {error && (
        <div className="card p-3 mb-4 text-sm text-rose-400 border-rose-500/40">
          {error}
        </div>
      )}

      {phase === "reviewing" && groups.length === 0 && (
        <div className="card p-8 text-center text-buzz-mute">
          ✨ No duplicates found in {scope === "all" ? "any city" : scope}.
        </div>
      )}

      {phase === "reviewing" && groups.length > 0 && (
        <div>
          <p className="text-sm text-buzz-mute mb-4">
            Found <strong>{groups.length}</strong> duplicate group{groups.length === 1 ? "" : "s"}.
            For each group, click the radio next to the venue you want to keep, then hit Merge.
            Auto-selected the one with the most events linked.
          </p>

          <div className="flex flex-col gap-4">
            {groups.map((g) => {
              const isResolved = resolved.has(g.key);
              const winnerId = winners[g.key];
              return (
                <div
                  key={g.key}
                  className={
                    "card p-4 " +
                    (isResolved ? "opacity-60 border-emerald-500/30" : "border-buzz-accent/30")
                  }
                >
                  <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
                    <p className="text-xs uppercase tracking-wider text-buzz-mute">
                      Match key: <code className="text-buzz-fg">{g.key}</code>
                    </p>
                    {!isResolved && (
                      <button
                        type="button"
                        onClick={() => merge(g)}
                        disabled={busyKey === g.key}
                        className="btn-primary text-sm"
                      >
                        {busyKey === g.key
                          ? "Merging…"
                          : `Merge ${g.venues.length - 1} into keeper`}
                      </button>
                    )}
                  </div>
                  <ul className="divide-y divide-buzz-border/60">
                    {g.venues.map((v) => (
                      <VenueRow
                        key={v.id}
                        v={v}
                        isWinner={v.id === winnerId}
                        disabled={isResolved}
                        onPick={() =>
                          setWinners((w) => ({ ...w, [g.key]: v.id }))
                        }
                      />
                    ))}
                  </ul>
                  {info[g.key] && (
                    <p className={
                      "text-xs mt-2 " +
                      (info[g.key].startsWith("Error") ? "text-rose-400" : "text-emerald-400")
                    }>
                      {info[g.key]}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function VenueRow({
  v,
  isWinner,
  disabled,
  onPick,
}: {
  v: DupeVenue;
  isWinner: boolean;
  disabled: boolean;
  onPick: () => void;
}) {
  return (
    <li className="py-2 flex items-start gap-3">
      <input
        type="radio"
        checked={isWinner}
        disabled={disabled}
        onChange={onPick}
        className="mt-1 w-4 h-4 cursor-pointer accent-buzz-accent shrink-0"
        aria-label={`Keep ${v.name}`}
      />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-medium truncate">{v.name}</span>
          {isWinner && (
            <span className="text-[10px] uppercase bg-emerald-500/20 text-emerald-400 px-1.5 py-0.5 rounded">
              Keeper
            </span>
          )}
          {!v.approved && (
            <span className="text-[10px] uppercase text-orange-400">pending</span>
          )}
          <span className="text-xs text-buzz-mute">· {v.eventCount} event{v.eventCount === 1 ? "" : "s"}</span>
          {v.hasFb && <span className="text-xs text-buzz-mute">· 📘 FB</span>}
          {v.hasWebsite && <span className="text-xs text-buzz-mute">· 🌐 site</span>}
          {v.ownerEmail && (
            <span className="text-xs text-buzz-mute truncate">· 👤 {v.ownerEmail}</span>
          )}
        </div>
        <div className="text-xs text-buzz-mute truncate">
          /{v.citySlug}/venues/{v.slug}
          {v.address && <> · {v.address}</>}
          {v.postcode && <> · {v.postcode}</>}
        </div>
      </div>
      {v.citySlug && v.approved && (
        <Link
          href={`/${v.citySlug}/venues/${v.slug}`}
          target="_blank"
          className="text-xs text-buzz-mute hover:text-buzz-accent shrink-0"
        >
          View ↗
        </Link>
      )}
    </li>
  );
}
