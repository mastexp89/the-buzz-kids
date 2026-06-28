"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { submitGig, type SubmitGigResult } from "./actions";
import ImageUploader from "@/components/ImageUploader";

type City = { id: string; name: string; slug: string; active: boolean };
type Venue = {
  id: string;
  name: string;
  slug: string;
  address: string | null;
  postcode: string | null;
  city_id: string;
  city: { name: string; slug: string } | null;
};
type Genre = { id: string; name: string; slug: string };

type VenueChoice =
  | { kind: "listed"; venue: Venue }
  | { kind: "new"; name: string };

export default function SubmitGigForm({
  cities,
  venues,
  genres,
}: {
  cities: City[];
  venues: Venue[];
  genres: Genre[];
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SubmitGigResult | null>(null);

  // Venue picker state
  const [venueQuery, setVenueQuery] = useState("");
  const [picked, setPicked] = useState<VenueChoice | null>(null);

  // New venue extras (only when picked.kind === "new")
  const [newVenueCityId, setNewVenueCityId] = useState<string>(cities[0]?.id ?? "");
  const [newVenueAddress, setNewVenueAddress] = useState("");
  const [newVenuePostcode, setNewVenuePostcode] = useState("");
  const [newVenueWebsite, setNewVenueWebsite] = useState("");

  // Genres
  const [selectedGenres, setSelectedGenres] = useState<Set<string>>(new Set());
  function toggleGenre(id: string) {
    setSelectedGenres((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // Artist tags (lightweight: just a list of names you can add)
  const [artistName, setArtistName] = useState("");
  const [newArtists, setNewArtists] = useState<string[]>([]);

  // Image
  const [imageUrl, setImageUrl] = useState("");

  // Self-name (so submitter gets auto-tagged as artist on the gig)
  const [selfArtistName, setSelfArtistName] = useState("");
  const [submitterName, setSubmitterName] = useState("");
  const [submitterContact, setSubmitterContact] = useState("");

  const filteredVenues = useMemo(() => {
    const q = venueQuery.trim().toLowerCase();
    if (!q) return venues.slice(0, 8);
    return venues
      .filter((v) =>
        v.name.toLowerCase().includes(q) ||
        (v.city?.name ?? "").toLowerCase().includes(q) ||
        (v.address ?? "").toLowerCase().includes(q)
      )
      .slice(0, 8);
  }, [venueQuery, venues]);

  const exactMatch = useMemo(() => {
    const q = venueQuery.trim().toLowerCase();
    if (!q) return false;
    return venues.some((v) => v.name.toLowerCase() === q);
  }, [venueQuery, venues]);

  function pickListed(v: Venue) {
    setPicked({ kind: "listed", venue: v });
    setVenueQuery(v.name);
  }
  function pickNew(name: string) {
    setPicked({ kind: "new", name });
    setVenueQuery(name);
  }
  function clearPick() {
    setPicked(null);
  }

  function addArtist() {
    const n = artistName.trim();
    if (!n) return;
    if (newArtists.includes(n)) {
      setArtistName("");
      return;
    }
    setNewArtists((p) => [...p, n]);
    setArtistName("");
  }

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setResult(null);
    if (!picked) {
      setError("Pick a venue from the list, or add a new one.");
      return;
    }
    const fd = new FormData(e.currentTarget);

    if (picked.kind === "listed") {
      fd.set("venue_id", picked.venue.id);
      fd.delete("new_venue_name");
      fd.delete("new_venue_city_id");
      fd.delete("new_venue_address");
      fd.delete("new_venue_postcode");
      fd.delete("new_venue_website");
    } else {
      fd.delete("venue_id");
      fd.set("new_venue_name", picked.name);
      fd.set("new_venue_city_id", newVenueCityId);
      fd.set("new_venue_address", newVenueAddress);
      fd.set("new_venue_postcode", newVenuePostcode);
      fd.set("new_venue_website", newVenueWebsite);
    }

    fd.delete("genres");
    selectedGenres.forEach((id) => fd.append("genres", id));

    fd.delete("new_artist_names");
    newArtists.forEach((n) => fd.append("new_artist_names", n));

    fd.set("image_url", imageUrl);
    fd.set("self_artist_name", selfArtistName);
    fd.set("submitter_name", submitterName);
    fd.set("submitter_contact", submitterContact);

    start(async () => {
      const res = await submitGig(fd);
      if ("error" in res) setError(res.error);
      else setResult(res);
    });
  }

  // ----- Confirmation states -----
  if (result && "ok" in result && result.kind === "pending_listed") {
    return (
      <div className="card p-8 text-center">
        <div className="text-5xl mb-3">✅</div>
        <h2 className="h-display text-3xl mb-2">Submitted!</h2>
        <p className="text-buzz-mute mb-4 max-w-md mx-auto">
          Your gig at <strong className="text-buzz-text">{result.venueName}</strong> has been
          sent to the venue for approval. Once they tap approve, it'll go live on The Buzz Guide.
        </p>
        <p className="text-sm text-buzz-mute mb-6">
          Tip: give the venue a quick heads-up so they know to log in and approve it.
        </p>
        <div className="flex flex-wrap gap-2 justify-center">
          <Link href="/" className="btn-secondary">Back to home</Link>
          <button
            type="button"
            onClick={() => { setResult(null); setError(null); }}
            className="btn-primary"
          >
            Submit another gig
          </button>
        </div>
      </div>
    );
  }

  if (result && "ok" in result && result.kind === "approved_listed") {
    return (
      <div className="card p-8 text-center">
        <div className="text-5xl mb-3">🎉</div>
        <h2 className="h-display text-3xl mb-2">Live now!</h2>
        <p className="text-buzz-mute mb-4 max-w-md mx-auto">
          Your gig at <strong className="text-buzz-text">{result.venueName}</strong> is up on
          The Buzz Guide right now — this venue hasn't claimed their page yet, so we publish gigs
          straight through.
        </p>
        <p className="text-sm text-buzz-mute mb-6">
          Know the venue? Send them the signup link so they can claim the page and manage
          future gigs themselves.
        </p>
        <div className="flex flex-wrap gap-2 justify-center">
          <Link
            href={`/${result.citySlug}/venues/${result.venueSlug}`}
            className="btn-primary"
          >
            View your gig
          </Link>
          <button
            type="button"
            onClick={() => { setResult(null); setError(null); }}
            className="btn-secondary"
          >
            Submit another gig
          </button>
          <Link href="/" className="btn-ghost">Back to home</Link>
        </div>
      </div>
    );
  }

  if (result && "ok" in result && result.kind === "pending_unlisted") {
    const signupUrl = typeof window !== "undefined"
      ? `${window.location.origin}/signup?venue=${encodeURIComponent(result.venueName)}`
      : `https://thebuzzguide.co.uk/signup?venue=${encodeURIComponent(result.venueName)}`;
    return (
      <div className="card p-8">
        <div className="text-center">
          <div className="text-5xl mb-3">📨</div>
          <h2 className="h-display text-3xl mb-2">We'll log it</h2>
          <p className="text-buzz-mute mb-4 max-w-lg mx-auto">
            <strong className="text-buzz-text">{result.venueName}</strong> isn't on The Buzz Guide yet.
            We've saved your gig as a venue suggestion — but the venue itself needs to sign up
            and approve gigs before yours can go live.
          </p>
        </div>
        <div className="bg-buzz-card border border-buzz-border rounded-xl p-5 my-6">
          <p className="eyebrow mb-2">Help us get them on The Buzz Guide</p>
          <p className="text-sm text-buzz-mute mb-3">
            Send this signup link to the booker / promoter at {result.venueName}. It's free for
            them to list, and the moment they sign up they can approve your gig.
          </p>
          <div className="flex flex-col sm:flex-row gap-2">
            <input
              readOnly
              value={signupUrl}
              className="input flex-1 text-sm"
              onFocus={(e) => e.currentTarget.select()}
            />
            <button
              type="button"
              className="btn-primary"
              onClick={() => navigator.clipboard?.writeText(signupUrl)}
            >
              Copy link
            </button>
          </div>
        </div>
        <div className="flex flex-wrap gap-2 justify-center">
          <Link href="/" className="btn-secondary">Back to home</Link>
          <button
            type="button"
            onClick={() => { setResult(null); setError(null); }}
            className="btn-primary"
          >
            Submit another gig
          </button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="card p-4 sm:p-6 grid sm:grid-cols-2 gap-4 overflow-hidden relative">
      {/* Honeypot — invisible to humans, irresistible to bots.
          Wrapper has overflow:hidden so the off-screen input doesn't make
          the whole page horizontally scrollable on mobile. */}
      <div aria-hidden="true" style={{ position: "absolute", width: 0, height: 0, overflow: "hidden" }}>
        <input
          type="text"
          name="website2"
          tabIndex={-1}
          autoComplete="off"
        />
      </div>

      {/* ---------- Venue picker ---------- */}
      <div className="sm:col-span-2">
        <label className="label">Venue *</label>
        <p className="help mb-2">
          Pick from venues already on The Buzz Guide. If you can't see yours, type the name and we'll
          flag it as missing.
        </p>

        {picked ? (
          <div className="flex items-center justify-between gap-3 rounded-xl border border-buzz-accent/50 bg-buzz-accent/10 px-4 py-3">
            <div className="min-w-0 flex-1">
              {picked.kind === "listed" ? (
                <>
                  <div className="font-semibold truncate">{picked.venue.name}</div>
                  <div className="text-xs text-buzz-mute truncate">
                    {[picked.venue.city?.name, picked.venue.address].filter(Boolean).join(" · ")}
                    {" "}· On The Buzz Guide ✓
                  </div>
                </>
              ) : (
                <>
                  <div className="font-semibold truncate">{picked.name}</div>
                  <div className="text-xs text-buzz-mute">
                    Not on The Buzz Guide yet — we'll log this as a venue suggestion.
                  </div>
                </>
              )}
            </div>
            <button type="button" onClick={clearPick} className="text-sm text-buzz-mute hover:text-buzz-accent transition shrink-0">
              Change
            </button>
          </div>
        ) : (
          <>
            <input
              type="text"
              className="input"
              placeholder="Start typing a venue name…"
              value={venueQuery}
              onChange={(e) => setVenueQuery(e.target.value)}
              autoComplete="off"
            />
            {venueQuery.trim().length > 0 && (
              <div className="mt-2 rounded-xl border border-buzz-border bg-buzz-card overflow-hidden">
                {filteredVenues.length > 0 && (
                  <ul className="divide-y divide-buzz-border">
                    {filteredVenues.map((v) => (
                      <li key={v.id}>
                        <button
                          type="button"
                          onClick={() => pickListed(v)}
                          className="w-full text-left px-4 py-2.5 hover:bg-buzz-surface transition min-w-0"
                        >
                          <div className="font-medium text-sm truncate">{v.name}</div>
                          <div className="text-xs text-buzz-mute truncate">
                            {[v.city?.name, v.address].filter(Boolean).join(" · ")}
                          </div>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                {!exactMatch && (
                  <button
                    type="button"
                    onClick={() => pickNew(venueQuery.trim())}
                    className="w-full text-left px-4 py-3 bg-buzz-surface/60 hover:bg-buzz-surface transition border-t border-buzz-border"
                  >
                    <div className="text-sm">
                      Use <strong>"{venueQuery.trim()}"</strong> as a new venue
                    </div>
                    <div className="text-xs text-buzz-mute">
                      We'll flag it for outreach — the venue must sign up to approve gigs.
                    </div>
                  </button>
                )}
              </div>
            )}
          </>
        )}
      </div>

      {/* Extra fields when adding a new venue */}
      {picked?.kind === "new" && (
        <>
          <div>
            <label className="label">Which city?</label>
            <select
              className="input"
              value={newVenueCityId}
              onChange={(e) => setNewVenueCityId(e.target.value)}
            >
              {cities.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Postcode (optional)</label>
            <input
              className="input"
              value={newVenuePostcode}
              onChange={(e) => setNewVenuePostcode(e.target.value)}
              placeholder="DD1 1AA"
            />
          </div>
          <div className="sm:col-span-2">
            <label className="label">Address (optional)</label>
            <input
              className="input"
              value={newVenueAddress}
              onChange={(e) => setNewVenueAddress(e.target.value)}
              placeholder="123 High Street"
            />
          </div>
          <div className="sm:col-span-2">
            <label className="label">Venue website / social (optional)</label>
            <input
              className="input"
              value={newVenueWebsite}
              onChange={(e) => setNewVenueWebsite(e.target.value)}
              placeholder="https://"
            />
          </div>
        </>
      )}

      {/* ---------- Gig details ---------- */}
      <div className="sm:col-span-2 mt-2">
        <p className="eyebrow mb-1">The gig</p>
        <hr className="border-buzz-border" />
      </div>

      <div className="sm:col-span-2">
        <label className="label">Gig title *</label>
        <input
          className="input"
          name="title"
          required
          placeholder="The Vegan Leather + support"
        />
      </div>

      <div>
        <label className="label">Start *</label>
        <input
          className="input"
          name="start_time"
          type="datetime-local"
          required
          style={{ colorScheme: "dark" }}
        />
      </div>
      <div>
        <label className="label">End (optional)</label>
        <input
          className="input"
          name="end_time"
          type="datetime-local"
          style={{ colorScheme: "dark" }}
        />
      </div>

      <div>
        <label className="label">Cover charge</label>
        <input
          className="input"
          name="cover_charge"
          placeholder="Free / £5 / £10 advance"
        />
      </div>
      <div>
        <label className="label">Ticket link</label>
        <input className="input" name="ticket_url" type="url" placeholder="https://" />
      </div>

      <div className="sm:col-span-2">
        <label className="label">Description</label>
        <textarea
          className="input min-h-[120px]"
          name="description"
          placeholder="Set times, support acts, anything fans should know."
        />
      </div>

      <div className="sm:col-span-2">
        <label className="label">Genres</label>
        <p className="help mb-2">Pick one or more — fans can filter by these.</p>
        <div className="flex flex-wrap gap-2">
          {genres.map((g) => {
            const on = selectedGenres.has(g.id);
            return (
              <button
                key={g.id}
                type="button"
                onClick={() => toggleGenre(g.id)}
                className={on ? "chip-accent" : "chip"}
              >
                {g.name}
              </button>
            );
          })}
        </div>
      </div>

      <div className="sm:col-span-2">
        <label className="label">Your artist / band / DJ name</label>
        <p className="help mb-2">
          We'll auto-tag you on this gig and create your artist page if you don't have one yet.
        </p>
        <input
          className="input"
          value={selfArtistName}
          onChange={(e) => setSelfArtistName(e.target.value)}
          placeholder="DJ Buzzkill"
        />
      </div>

      <div className="sm:col-span-2">
        <label className="label">Other artists / bands on the bill</label>
        <div className="flex gap-2">
          <input
            className="input flex-1"
            value={artistName}
            onChange={(e) => setArtistName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addArtist();
              }
            }}
            placeholder="Add another act and press Enter"
          />
          <button type="button" onClick={addArtist} className="btn-secondary">Add</button>
        </div>
        {newArtists.length > 0 && (
          <div className="flex flex-wrap gap-2 mt-2">
            {newArtists.map((n) => (
              <span key={n} className="chip-accent inline-flex items-center gap-1">
                {n}
                <button
                  type="button"
                  onClick={() => setNewArtists((p) => p.filter((x) => x !== n))}
                  className="opacity-70 hover:opacity-100"
                  aria-label={`Remove ${n}`}
                >×</button>
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="sm:col-span-2">
        <label className="label">Gig poster / photo (optional)</label>
        <ImageUploader folder="events" value={imageUrl} onChange={setImageUrl} />
      </div>

      {/* ---------- Contact info (only really useful for unlisted venues) ---------- */}
      {picked?.kind === "new" && (
        <>
          <div className="sm:col-span-2 mt-2">
            <p className="eyebrow mb-1">So we can follow up</p>
            <hr className="border-buzz-border" />
          </div>
          <div>
            <label className="label">Your name</label>
            <input
              className="input"
              value={submitterName}
              onChange={(e) => setSubmitterName(e.target.value)}
              placeholder="Alex"
            />
          </div>
          <div>
            <label className="label">Best way to reach you</label>
            <input
              className="input"
              value={submitterContact}
              onChange={(e) => setSubmitterContact(e.target.value)}
              placeholder="email or @instagram"
            />
          </div>
        </>
      )}

      {error && <div className="sm:col-span-2 text-sm text-rose-400">{error}</div>}

      <div className="sm:col-span-2 flex flex-wrap gap-3 items-center pt-2">
        <button type="submit" className="btn-primary" disabled={pending}>
          {pending ? "Submitting…" : "Submit gig"}
        </button>
        <span className="text-xs text-buzz-mute">
          Free. The venue (or our team) will review before your gig goes live.
        </span>
      </div>
    </form>
  );
}
