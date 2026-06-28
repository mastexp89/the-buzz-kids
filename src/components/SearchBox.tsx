"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";

type VenueResult = { id: string; name: string; slug: string; logo_url: string | null; cover_photo_url: string | null; image_url: string | null; city: { slug: string; name: string } | null };
type ArtistResult = { id: string; name: string; slug: string; image_url: string | null };
type EventResult = { id: string; title: string; start_time: string; image_url: string | null; venue: { name: string; city: { slug: string; name: string } | null } | null };

export default function SearchBox() {
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [venues, setVenues] = useState<VenueResult[]>([]);
  const [artists, setArtists] = useState<ArtistResult[]>([]);
  const [events, setEvents] = useState<EventResult[]>([]);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Close on route change
  useEffect(() => {
    setOpen(false);
    setQuery("");
  }, [pathname]);

  // Lock body scroll while open + focus input
  useEffect(() => {
    if (open) {
      document.body.style.overflow = "hidden";
      setTimeout(() => inputRef.current?.focus(), 50);
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  // Cmd/Ctrl + K shortcut
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      } else if (e.key === "Escape" && open) {
        setOpen(false);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  // Debounced search
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!query.trim()) {
      setVenues([]);
      setArtists([]);
      setEvents([]);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
        const data = await res.json();
        setVenues(data.venues ?? []);
        setArtists(data.artists ?? []);
        setEvents(data.events ?? []);
      } catch {
        setVenues([]);
        setArtists([]);
        setEvents([]);
      } finally {
        setLoading(false);
      }
    }, 200);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query]);

  const totalResults = venues.length + artists.length + events.length;

  return (
    <>
      <button
        type="button"
        aria-label="Search"
        onClick={() => setOpen(true)}
        className="inline-flex items-center justify-center w-9 h-9 rounded-lg hover:bg-buzz-card transition"
        title="Search (⌘K)"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
          <circle cx="11" cy="11" r="7" />
          <path d="M21 21l-4.3-4.3" />
        </svg>
      </button>

      {open && (
        <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-sm" onClick={() => setOpen(false)}>
          <div className="container-page pt-16 sm:pt-24" onClick={(e) => e.stopPropagation()}>
            <div className="card p-3 sm:p-4 max-w-2xl mx-auto">
              <div className="flex items-center gap-3">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-buzz-mute shrink-0">
                  <circle cx="11" cy="11" r="7" />
                  <path d="M21 21l-4.3-4.3" />
                </svg>
                <input
                  ref={inputRef}
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search venues, artists or gigs…"
                  className="flex-1 bg-transparent outline-none text-lg placeholder-buzz-mute"
                />
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="text-xs text-buzz-mute hover:text-buzz-text px-2 py-1 rounded border border-buzz-border"
                >
                  Esc
                </button>
              </div>

              {query.trim() && (
                <div className="mt-4 max-h-[60vh] overflow-y-auto">
                  {loading && <div className="text-sm text-buzz-mute px-2 py-2">Searching…</div>}

                  {!loading && totalResults === 0 && (
                    <div className="text-sm text-buzz-mute px-2 py-4">No results for "{query}".</div>
                  )}

                  {venues.length > 0 && (
                    <div className="mb-3">
                      <div className="eyebrow text-[10px] px-2 py-1">Venues</div>
                      <ul className="flex flex-col">
                        {venues.map((v) => (
                          <li key={v.id}>
                            <Link
                              href={`/${v.city?.slug ?? "dundee"}/venues/${v.slug}`}
                              className="flex items-center gap-3 px-2 py-2 rounded-lg hover:bg-buzz-surface transition"
                            >
                              {(() => {
                                // Image priority chain — matches the rest of the app:
                                //   logo (sharp wordmark) → cover photo → generic image_url → bee fallback.
                                const url = v.logo_url ?? v.cover_photo_url ?? v.image_url;
                                // Logos look best contained (no crop); photos look best covering.
                                const fit = v.logo_url ? "contain" : "cover";
                                return url ? (
                                  <span
                                    className="w-9 h-9 rounded-md shrink-0 bg-buzz-surface"
                                    style={{ backgroundImage: `url(${url})`, backgroundSize: fit, backgroundPosition: "center", backgroundRepeat: "no-repeat" }}
                                  />
                                ) : (
                                  <span className="w-9 h-9 rounded-md shrink-0 bg-buzz-surface border border-buzz-border grid place-items-center">🐝</span>
                                );
                              })()}
                              <div className="min-w-0 flex-1">
                                <div className="font-medium truncate">{v.name}</div>
                                <div className="text-xs text-buzz-mute truncate">{v.city?.name ?? "Venue"}</div>
                              </div>
                            </Link>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {events.length > 0 && (
                    <div className="mb-3">
                      <div className="eyebrow text-[10px] px-2 py-1">Upcoming gigs</div>
                      <ul className="flex flex-col">
                        {events.map((e) => {
                          const citySlug = e.venue?.city?.slug ?? "dundee";
                          const when = new Date(e.start_time);
                          const dateLabel = when.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
                          return (
                            <li key={e.id}>
                              <Link
                                href={`/${citySlug}/events/${e.id}`}
                                className="flex items-center gap-3 px-2 py-2 rounded-lg hover:bg-buzz-surface transition"
                              >
                                {e.image_url ? (
                                  <span
                                    className="w-9 h-9 rounded-md shrink-0 bg-buzz-surface"
                                    style={{ backgroundImage: `url(${e.image_url})`, backgroundSize: "cover", backgroundPosition: "center" }}
                                  />
                                ) : (
                                  <span className="w-9 h-9 rounded-md shrink-0 bg-buzz-surface border border-buzz-border grid place-items-center">🎟️</span>
                                )}
                                <div className="min-w-0 flex-1">
                                  <div className="font-medium truncate">{e.title}</div>
                                  <div className="text-xs text-buzz-mute truncate">
                                    {dateLabel}
                                    {e.venue?.name ? ` · ${e.venue.name}` : ""}
                                  </div>
                                </div>
                              </Link>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  )}

                  {artists.length > 0 && (
                    <div className="mb-1">
                      <div className="eyebrow text-[10px] px-2 py-1">Artists, bands &amp; DJs</div>
                      <ul className="flex flex-col">
                        {artists.map((a) => (
                          <li key={a.id}>
                            <Link
                              href={`/artists/${a.slug}`}
                              className="flex items-center gap-3 px-2 py-2 rounded-lg hover:bg-buzz-surface transition"
                            >
                              {a.image_url ? (
                                <span
                                  className="w-9 h-9 rounded-full shrink-0 bg-buzz-surface"
                                  style={{ backgroundImage: `url(${a.image_url})`, backgroundSize: "cover", backgroundPosition: "center" }}
                                />
                              ) : (
                                <span className="w-9 h-9 rounded-full shrink-0 bg-buzz-accent/20 grid place-items-center">🎵</span>
                              )}
                              <div className="min-w-0 flex-1">
                                <div className="font-medium truncate">{a.name}</div>
                                <div className="text-xs text-buzz-mute truncate">Artist</div>
                              </div>
                            </Link>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}

              {!query.trim() && (
                <div className="text-xs text-buzz-mute mt-3 px-2">
                  Try a venue name, band name or gig title.
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
