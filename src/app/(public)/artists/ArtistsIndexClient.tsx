"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

type Artist = {
  id: string;
  name: string;
  slug: string;
  image_url: string | null;
  claimed: boolean;
  upcoming: number;
  total: number;
};

type Filter = "all" | "upcoming" | "claimed";

export default function ArtistsIndexClient({ artists }: { artists: Artist[] }) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return artists.filter((a) => {
      if (filter === "upcoming" && a.upcoming === 0) return false;
      if (filter === "claimed" && !a.claimed) return false;
      if (q && !a.name.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [artists, query, filter]);

  return (
    <>
      <div className="flex flex-col sm:flex-row gap-3 mb-6">
        <input
          type="text"
          className="input flex-1 sm:max-w-md"
          placeholder="Search artists, bands, DJs…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="flex gap-2 flex-wrap">
          <Pill label={`All (${artists.length})`}            active={filter === "all"}      onClick={() => setFilter("all")} />
          <Pill label={`Upcoming (${artists.filter((a) => a.upcoming > 0).length})`} active={filter === "upcoming"} onClick={() => setFilter("upcoming")} />
          <Pill label={`Claimed (${artists.filter((a) => a.claimed).length})`}     active={filter === "claimed"}  onClick={() => setFilter("claimed")} />
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="card p-10 text-center">
          <div className="text-4xl mb-2">🎤</div>
          <p className="text-buzz-mute">
            {query
              ? `No matches for "${query}".`
              : "No artists in this view yet."}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
          {filtered.map((a) => (
            <Link
              key={a.id}
              href={`/artists/${a.slug}`}
              className="card p-4 flex flex-col items-center text-center hover:border-buzz-accent transition group"
            >
              {a.image_url ? (
                <div
                  className="w-24 h-24 rounded-full bg-buzz-surface border border-buzz-border mb-3 group-hover:border-buzz-accent transition"
                  style={{
                    backgroundImage: `url(${a.image_url})`,
                    backgroundSize: "cover",
                    backgroundPosition: "center",
                  }}
                />
              ) : (
                <div className="w-24 h-24 rounded-full bg-gradient-to-br from-buzz-accent/30 to-buzz-card border border-buzz-border grid place-items-center mb-3">
                  <span className="text-3xl">🎵</span>
                </div>
              )}
              <div className="font-medium leading-tight text-sm sm:text-base">
                {a.name}
              </div>
              <div className="text-xs text-buzz-mute mt-1">
                {a.upcoming > 0 ? (
                  <span className="text-buzz-accent">
                    {a.upcoming} upcoming gig{a.upcoming === 1 ? "" : "s"}
                  </span>
                ) : a.total > 0 ? (
                  <span>{a.total} past gig{a.total === 1 ? "" : "s"}</span>
                ) : (
                  <span>No gigs listed</span>
                )}
              </div>
              {a.claimed && (
                <span className="mt-2 text-[10px] uppercase tracking-wide bg-buzz-accent/15 text-buzz-accent px-1.5 py-0.5 rounded">
                  Claimed
                </span>
              )}
            </Link>
          ))}
        </div>
      )}
    </>
  );
}

function Pill({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        active
          ? "px-3 py-1.5 rounded-full text-sm font-semibold bg-buzz-accent text-black"
          : "px-3 py-1.5 rounded-full text-sm bg-buzz-card border border-buzz-border hover:border-buzz-accent transition"
      }
    >
      {label}
    </button>
  );
}
