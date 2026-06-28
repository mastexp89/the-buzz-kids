"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  searchEventsToTakeOwnership,
  takeOwnershipOfEvent,
  relinquishOwnership,
  searchVenuesForOrganiser,
  listActiveCitiesForOrganiser,
  addEventAsOrganiser,
  type EventLite,
  type VenueOption,
  type CityOption,
} from "./actions";

type Mode = "list" | "claim" | "create";

export default function OrganiserEventsClient({
  organiserId,
  organiserName,
  initialEvents,
}: {
  organiserId: string;
  organiserName: string;
  initialEvents: EventLite[];
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [events, setEvents] = useState<EventLite[]>(initialEvents);
  const [mode, setMode] = useState<Mode>("list");
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  function refresh() {
    router.refresh();
  }

  function handleRemove(eventId: string) {
    if (!confirm("Remove yourself as organiser from this event? The event itself stays — just unlinks you.")) return;
    startTransition(async () => {
      const r = await relinquishOwnership(organiserId, eventId);
      if ("error" in r) {
        setError(r.error);
        return;
      }
      setEvents((es) => es.filter((e) => e.id !== eventId));
    });
  }

  return (
    <div>
      <div className="flex flex-wrap gap-2 mb-6">
        <button
          type="button"
          onClick={() => setMode("list")}
          className={mode === "list" ? "btn-primary" : "btn-secondary"}
        >
          📋 Your events ({events.length})
        </button>
        <button
          type="button"
          onClick={() => setMode("claim")}
          className={mode === "claim" ? "btn-primary" : "btn-secondary"}
        >
          🔗 Take ownership of existing
        </button>
        <button
          type="button"
          onClick={() => setMode("create")}
          className={mode === "create" ? "btn-primary" : "btn-secondary"}
        >
          + Add new event
        </button>
      </div>

      {error && (
        <div className="card p-3 mb-4 text-sm text-rose-400 border-rose-500/40">{error}</div>
      )}
      {info && (
        <div className="card p-3 mb-4 text-sm text-emerald-400 border-emerald-500/40">{info}</div>
      )}

      {mode === "list" && <EventsList events={events} onRemove={handleRemove} />}
      {mode === "claim" && (
        <ClaimExistingForm
          organiserId={organiserId}
          onClaimed={(e) => {
            setEvents((es) => [e, ...es]);
            setInfo(`Linked "${e.title}" to ${organiserName}.`);
            refresh();
          }}
          onError={setError}
        />
      )}
      {mode === "create" && (
        <CreateEventForm
          organiserId={organiserId}
          onCreated={(eventId) => {
            setMode("list");
            setInfo("Event submitted — admin will review and publish it shortly.");
            refresh();
          }}
          onError={setError}
        />
      )}
    </div>
  );
}

function EventsList({
  events,
  onRemove,
}: {
  events: EventLite[];
  onRemove: (id: string) => void;
}) {
  if (events.length === 0) {
    return (
      <div className="card p-8 text-center text-buzz-mute">
        No events linked to this organiser yet. Use the buttons above to take
        ownership of an existing gig or add a new one.
      </div>
    );
  }
  return (
    <ul className="card divide-y divide-buzz-border/60">
      {events.map((e) => (
        <li key={e.id} className="p-4 flex items-center gap-3">
          <div className="flex-1 min-w-0">
            <div className="font-medium truncate">
              {e.title}
              {e.cancelled && (
                <span className="ml-2 text-[10px] uppercase text-rose-400">Cancelled</span>
              )}
              {e.status === "pending" && (
                <span className="ml-2 text-[10px] uppercase text-buzz-accent">Pending review</span>
              )}
              {e.status === "rejected" && (
                <span className="ml-2 text-[10px] uppercase text-rose-400">Rejected</span>
              )}
            </div>
            <div className="text-xs text-buzz-mute">
              {new Date(e.start_time).toLocaleString("en-GB", {
                day: "2-digit",
                month: "short",
                year: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              })}
              {" · "}
              {e.venueName}
            </div>
          </div>
          {e.citySlug && (
            <Link
              href={`/${e.citySlug}/events/${e.id}`}
              target="_blank"
              className="text-xs text-buzz-mute hover:text-buzz-accent"
            >
              View ↗
            </Link>
          )}
          <button
            type="button"
            onClick={() => onRemove(e.id)}
            className="text-xs text-rose-400 hover:text-rose-300"
          >
            Unlink
          </button>
        </li>
      ))}
    </ul>
  );
}

function ClaimExistingForm({
  organiserId,
  onClaimed,
  onError,
}: {
  organiserId: string;
  onClaimed: (e: EventLite) => void;
  onError: (msg: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<EventLite[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (query.trim().length < 2) {
      setResults(null);
      return;
    }
    setSearching(true);
    const t = setTimeout(async () => {
      const r = await searchEventsToTakeOwnership(organiserId, query);
      if (cancelled) return;
      if ("error" in r) {
        onError(r.error);
      } else {
        setResults(r.events);
      }
      setSearching(false);
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [query, organiserId, onError]);

  async function claim(e: EventLite) {
    setBusyId(e.id);
    const r = await takeOwnershipOfEvent(organiserId, e.id);
    setBusyId(null);
    if ("error" in r) {
      onError(r.error);
      return;
    }
    onClaimed(e);
    setResults((rs) => (rs ? rs.filter((x) => x.id !== e.id) : null));
  }

  return (
    <div className="card p-5">
      <p className="eyebrow text-buzz-accent text-[10px] mb-2">Take ownership of existing</p>
      <h2 className="font-display text-xl mb-3">Find a gig you're organising</h2>
      <p className="text-xs text-buzz-mute mb-4">
        Search by title — useful if a gig you're promoting was already added by
        the venue or pulled in by our scrapers.
      </p>
      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search upcoming events by title…"
        className="input mb-4"
        autoFocus
      />
      {searching && <p className="text-xs text-buzz-mute">Searching…</p>}
      {!searching && results && results.length === 0 && query.trim().length >= 2 && (
        <p className="text-xs text-buzz-mute">
          No upcoming events match "{query}". Try a different keyword, or use
          "+ Add new event" to create one.
        </p>
      )}
      {!searching && results && results.length > 0 && (
        <ul className="divide-y divide-buzz-border/60">
          {results.map((e) => (
            <li key={e.id} className="py-2 flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <div className="font-medium truncate">{e.title}</div>
                <div className="text-xs text-buzz-mute">
                  {new Date(e.start_time).toLocaleString("en-GB", {
                    day: "2-digit",
                    month: "short",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                  {" · "}
                  {e.venueName}
                </div>
              </div>
              <button
                type="button"
                onClick={() => claim(e)}
                disabled={busyId === e.id}
                className="btn-primary text-xs whitespace-nowrap"
              >
                {busyId === e.id ? "Linking…" : "I organise this"}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function CreateEventForm({
  organiserId,
  onCreated,
  onError,
}: {
  organiserId: string;
  onCreated: (id: string) => void;
  onError: (msg: string) => void;
}) {
  const [title, setTitle] = useState("");
  // Venue picker now has three states:
  //   1. pickedVenue !== null            → use existing
  //   2. creatingVenue === true          → fill in new-venue fields
  //   3. neither                          → search/select prompt
  const [venueQuery, setVenueQuery] = useState("");
  const [venueResults, setVenueResults] = useState<VenueOption[] | null>(null);
  const [pickedVenue, setPickedVenue] = useState<VenueOption | null>(null);
  const [creatingVenue, setCreatingVenue] = useState(false);
  const [newVenueName, setNewVenueName] = useState("");
  const [newVenueCityId, setNewVenueCityId] = useState("");
  const [newVenueAddress, setNewVenueAddress] = useState("");
  const [newVenuePostcode, setNewVenuePostcode] = useState("");
  const [cities, setCities] = useState<CityOption[]>([]);

  const [startDate, setStartDate] = useState("");
  const [startTime, setStartTime] = useState("20:00");
  const [endTime, setEndTime] = useState("");
  const [description, setDescription] = useState("");
  const [coverCharge, setCoverCharge] = useState("");
  const [ticketUrl, setTicketUrl] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (pickedVenue || creatingVenue) return; // user has chosen one path
    let cancelled = false;
    if (venueQuery.trim().length < 1) {
      setVenueResults(null);
      return;
    }
    const t = setTimeout(async () => {
      const r = await searchVenuesForOrganiser(venueQuery);
      if (!cancelled) setVenueResults(r);
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [venueQuery, pickedVenue, creatingVenue]);

  // Pull the cities list once the moment the user opts to create a new
  // venue — defer the round-trip until it's actually needed.
  useEffect(() => {
    if (!creatingVenue || cities.length > 0) return;
    let cancelled = false;
    listActiveCitiesForOrganiser().then((r) => {
      if (!cancelled) setCities(r);
    });
    return () => { cancelled = true; };
  }, [creatingVenue, cities.length]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!pickedVenue && !creatingVenue) {
      onError("Pick an existing venue, or click \"This venue isn't on Buzz yet\" to create one.");
      return;
    }
    if (creatingVenue) {
      if (!newVenueName.trim()) {
        onError("Type a name for the new venue.");
        return;
      }
      if (!newVenueCityId) {
        onError("Pick a city for the new venue.");
        return;
      }
    }
    if (!startDate || !startTime) {
      onError("Pick a start date and time.");
      return;
    }
    setBusy(true);
    const startIso = new Date(`${startDate}T${startTime}`).toISOString();
    const endIso = endTime ? new Date(`${startDate}T${endTime}`).toISOString() : null;

    const r = await addEventAsOrganiser(organiserId, {
      title,
      // Send either the picked venue's id OR the create-new fields;
      // the action picks one path based on what's populated.
      venue_id: pickedVenue?.id ?? null,
      create_venue_name: creatingVenue ? newVenueName : null,
      create_venue_city_id: creatingVenue ? newVenueCityId : null,
      create_venue_address: creatingVenue ? newVenueAddress : null,
      create_venue_postcode: creatingVenue ? newVenuePostcode : null,
      start_time: startIso,
      end_time: endIso,
      description: description || null,
      cover_charge: coverCharge || null,
      ticket_url: ticketUrl || null,
    });
    setBusy(false);
    if ("error" in r) {
      onError(r.error);
      return;
    }
    onCreated(r.eventId);
  }

  return (
    <form onSubmit={submit} className="card p-5 flex flex-col gap-4">
      <p className="eyebrow text-buzz-accent text-[10px]">Add new event</p>

      <div>
        <label className="label">Title</label>
        <input
          className="input"
          required
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="e.g. Friday Night Live"
        />
      </div>

      <div>
        <label className="label">Venue</label>
        {pickedVenue ? (
          <div className="card p-3 flex items-center justify-between gap-3 bg-buzz-bg/40">
            <div className="text-sm">
              <span className="font-medium">{pickedVenue.name}</span>
              {pickedVenue.cityName && (
                <span className="text-buzz-mute"> · {pickedVenue.cityName}</span>
              )}
            </div>
            <button
              type="button"
              onClick={() => {
                setPickedVenue(null);
                setVenueQuery("");
              }}
              className="text-xs text-rose-400 hover:text-rose-300"
            >
              Change
            </button>
          </div>
        ) : creatingVenue ? (
          // Brand-new venue path — admin will review the venue along
          // with the event. Address + postcode optional; city required
          // so the event can land on the right city page.
          <div className="card p-3 flex flex-col gap-3 bg-buzz-bg/40 border-buzz-accent/30">
            <div className="flex items-baseline justify-between gap-3">
              <p className="text-xs font-medium">🆕 Creating new venue</p>
              <button
                type="button"
                onClick={() => {
                  setCreatingVenue(false);
                  setNewVenueName("");
                  setNewVenueCityId("");
                  setNewVenueAddress("");
                  setNewVenuePostcode("");
                }}
                className="text-xs text-rose-400 hover:text-rose-300"
              >
                Cancel
              </button>
            </div>
            <div className="grid sm:grid-cols-2 gap-3">
              <div>
                <label className="label">Venue name *</label>
                <input
                  className="input"
                  value={newVenueName}
                  onChange={(e) => setNewVenueName(e.target.value)}
                  placeholder="e.g. The Old Pump House"
                  required
                />
              </div>
              <div>
                <label className="label">City *</label>
                <select
                  className="input"
                  value={newVenueCityId}
                  onChange={(e) => setNewVenueCityId(e.target.value)}
                  required
                >
                  <option value="">— pick a city —</option>
                  {cities.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="grid sm:grid-cols-2 gap-3">
              <div>
                <label className="label">Address (optional)</label>
                <input
                  className="input"
                  value={newVenueAddress}
                  onChange={(e) => setNewVenueAddress(e.target.value)}
                  placeholder="42 High Street"
                />
              </div>
              <div>
                <label className="label">Postcode (optional)</label>
                <input
                  className="input"
                  value={newVenuePostcode}
                  onChange={(e) => setNewVenuePostcode(e.target.value.toUpperCase())}
                  placeholder="DD1 1XX"
                />
              </div>
            </div>
            <p className="help">
              Admin will review the new venue before it shows publicly. Your event lands at the right place either way.
            </p>
          </div>
        ) : (
          <>
            <input
              type="search"
              className="input"
              value={venueQuery}
              onChange={(e) => setVenueQuery(e.target.value)}
              placeholder="Type the venue name to search…"
            />
            {venueResults && venueResults.length > 0 && (
              <div className="mt-2 card divide-y divide-buzz-border/60 max-h-72 overflow-y-auto">
                {venueResults.map((v) => (
                  <button
                    type="button"
                    key={v.id}
                    onClick={() => {
                      setPickedVenue(v);
                      setVenueResults(null);
                    }}
                    className="w-full text-left p-2 hover:bg-buzz-surface text-sm flex items-center justify-between gap-2"
                  >
                    <span className="truncate">{v.name}</span>
                    {v.cityName && <span className="text-xs text-buzz-mute">{v.cityName}</span>}
                  </button>
                ))}
              </div>
            )}
            {/* Always-visible "create new" affordance. Old copy told
                organisers their venue "needs to sign up first" which
                was wrong — promoters routinely book gigs at venues
                that aren't on Buzz (pop-ups, community halls, brand-
                new bars). Now they can create one on the fly here. */}
            <button
              type="button"
              onClick={() => {
                setCreatingVenue(true);
                // Pre-seed the new-venue name from whatever the user typed.
                if (venueQuery.trim()) setNewVenueName(venueQuery.trim());
                setVenueResults(null);
              }}
              className="text-xs text-buzz-accent hover:underline mt-2"
            >
              + This venue isn&apos;t on Buzz yet — add it
            </button>
          </>
        )}
      </div>

      <div className="grid sm:grid-cols-3 gap-3">
        <div>
          <label className="label">Date</label>
          <input
            type="date"
            className="input"
            required
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
          />
        </div>
        <div>
          <label className="label">Start time</label>
          <input
            type="time"
            className="input"
            required
            value={startTime}
            onChange={(e) => setStartTime(e.target.value)}
          />
        </div>
        <div>
          <label className="label">End time (optional)</label>
          <input
            type="time"
            className="input"
            value={endTime}
            onChange={(e) => setEndTime(e.target.value)}
          />
        </div>
      </div>

      <div>
        <label className="label">Description (optional)</label>
        <textarea
          className="input min-h-[80px]"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Lineup, theme, anything fans should know."
        />
      </div>

      <div className="grid sm:grid-cols-2 gap-3">
        <div>
          <label className="label">Price / cover (optional)</label>
          <input
            className="input"
            value={coverCharge}
            onChange={(e) => setCoverCharge(e.target.value)}
            placeholder="e.g. £8 / £6 conc"
          />
        </div>
        <div>
          <label className="label">Ticket URL (optional)</label>
          <input
            type="url"
            className="input"
            value={ticketUrl}
            onChange={(e) => setTicketUrl(e.target.value)}
            placeholder="https://…"
          />
        </div>
      </div>

      <p className="text-xs text-buzz-mute">
        ⚠️ New events submitted by organisers go to admin review before they
        appear publicly. We usually approve within 24 hours.
      </p>

      <button type="submit" className="btn-primary" disabled={busy}>
        {busy ? "Submitting…" : "Submit for review"}
      </button>
    </form>
  );
}
