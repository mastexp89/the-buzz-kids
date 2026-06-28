"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { setArtistApproval, deleteArtistFromList } from "./actions";

type Artist = {
  id: string;
  name: string;
  slug: string;
  image_url: string | null;
  approved: boolean;
  claimed_by: string | null;
  created_at: string;
  upcoming_count: number;
  claimer: { email: string | null; display_name: string | null } | null;
};

type Tab = "pending" | "approved" | "all";

export default function ArtistsClient({
  pending,
  approved,
}: {
  pending: Artist[];
  approved: Artist[];
}) {
  const [tab, setTab] = useState<Tab>(pending.length > 0 ? "pending" : "all");
  const [query, setQuery] = useState("");
  const all = useMemo(() => [...pending, ...approved], [pending, approved]);

  const list = tab === "pending" ? pending : tab === "approved" ? approved : all;
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return list;
    return list.filter((a) =>
      a.name.toLowerCase().includes(q) ||
      a.slug.toLowerCase().includes(q) ||
      (a.claimer?.email ?? "").toLowerCase().includes(q)
    );
  }, [list, query]);

  return (
    <>
      <div className="flex flex-wrap gap-2 mb-4">
        <Pill active={tab === "pending"} onClick={() => setTab("pending")}>
          Pending ({pending.length})
        </Pill>
        <Pill active={tab === "approved"} onClick={() => setTab("approved")}>
          Approved ({approved.length})
        </Pill>
        <Pill active={tab === "all"} onClick={() => setTab("all")}>
          All ({all.length})
        </Pill>
      </div>

      <input
        type="search"
        placeholder="Search by name, slug, or email…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        className="input mb-6"
      />

      {filtered.length === 0 ? (
        <div className="card p-10 text-buzz-mute text-center">
          {query ? `No artists match "${query}".` : "No artists in this view."}
        </div>
      ) : (
        <ul className="card divide-y divide-buzz-border/60">
          {filtered.map((a) => <Row key={a.id} artist={a} />)}
        </ul>
      )}
    </>
  );
}

function Pill({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        active
          ? "px-4 py-2 rounded-full font-semibold bg-buzz-accent text-black text-sm"
          : "px-4 py-2 rounded-full bg-buzz-card border border-buzz-border hover:border-buzz-accent transition text-sm"
      }
    >
      {children}
    </button>
  );
}

function Row({ artist: a }: { artist: Artist }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const [isApproved, setIsApproved] = useState(a.approved);

  if (stale) {
    return (
      <li className="px-4 py-3 text-sm text-buzz-mute italic">Removed: {a.name}</li>
    );
  }

  return (
    <li className="px-4 py-4">
      <div className="flex items-center gap-3">
        {a.image_url ? (
          <div
            className="w-12 h-12 rounded-full bg-buzz-surface shrink-0"
            style={{ backgroundImage: `url(${a.image_url})`, backgroundSize: "cover", backgroundPosition: "center" }}
          />
        ) : (
          <div className="w-12 h-12 rounded-full bg-buzz-surface border border-buzz-border grid place-items-center text-xl shrink-0">🎵</div>
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <Link href={`/artists/${a.slug}`} target="_blank" className="font-semibold truncate hover:text-buzz-accent">
              {a.name}
            </Link>
            {isApproved ? (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-600/20 text-emerald-400 uppercase tracking-wider">Live</span>
            ) : (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-buzz-accent/20 text-buzz-accent uppercase tracking-wider">Pending</span>
            )}
            {a.upcoming_count > 0 && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-buzz-surface border border-buzz-border text-buzz-mute">
                {a.upcoming_count} upcoming
              </span>
            )}
          </div>
          <div className="text-xs text-buzz-mute truncate">
            /{a.slug}
            {a.claimer ? <> · claimed by {a.claimer.display_name ?? a.claimer.email}</> : <> · auto-created</>}
            {" "}· joined {new Date(a.created_at).toLocaleDateString("en-GB")}
          </div>
        </div>
        <div className="flex gap-1.5 shrink-0">
          {!isApproved ? (
            <button
              type="button"
              disabled={pending}
              className="btn-primary !py-1.5 !px-3 text-xs"
              onClick={() => start(async () => {
                const r = await setArtistApproval(a.id, true);
                if (r?.error) setError(r.error);
                else setIsApproved(true);
              })}
            >
              {pending ? "…" : "Approve"}
            </button>
          ) : (
            <button
              type="button"
              disabled={pending}
              className="btn-secondary !py-1.5 !px-3 text-xs"
              onClick={() => start(async () => {
                const r = await setArtistApproval(a.id, false);
                if (r?.error) setError(r.error);
                else setIsApproved(false);
              })}
            >
              Hide
            </button>
          )}
          <button
            type="button"
            disabled={pending}
            className="btn-danger !py-1.5 !px-3 text-xs"
            onClick={() => {
              // Confirm copy varies depending on whether the artist is
              // claimed (a real user controls the page) and whether
              // there are upcoming events that'll lose their tag.
              const claimedNote = a.claimer
                ? `\n\n⚠ This artist is claimed by ${a.claimer.display_name ?? a.claimer.email}. Their user account stays, but their artist page disappears.`
                : "";
              const eventsNote = a.upcoming_count > 0
                ? `\n\n⚠ ${a.upcoming_count} upcoming event${a.upcoming_count === 1 ? "" : "s"} will lose this artist tag (the events themselves stay).`
                : "";
              if (!confirm(
                `Delete "${a.name}"?\n\nThis removes the artist row entirely along with event tags, festival lineup entries, fan favourites, and any claim history.${claimedNote}${eventsNote}\n\nThis cannot be undone.`,
              )) return;
              start(async () => {
                const r = await deleteArtistFromList(a.id);
                if (r?.error) setError(r.error);
                else setStale(true);
              });
            }}
          >
            Delete
          </button>
        </div>
      </div>
      {error && <div className="text-xs text-rose-400 mt-2">{error}</div>}
    </li>
  );
}
