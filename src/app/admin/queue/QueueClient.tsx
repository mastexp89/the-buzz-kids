"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import {
  approveEvent,
  rejectEvent,
  dismissSuggestion,
  deleteSuggestion,
  approveVenueClaim,
  rejectVenueClaim,
} from "./actions";
import {
  approveVenue,
  approveOrganiser,
  unapproveOrganiser,
} from "../actions";
import { recurrenceLabel } from "@/lib/recurrence";

const BUSINESS_TYPE_LABEL: Record<string, string> = {
  individual: "Individual",
  multiple: "Multiple places",
  agency: "Agency",
};

type PendingEvent = {
  id: string;
  title: string;
  start_time: string;
  end_time: string | null;
  end_date: string | null;
  recurrence_pattern: string | null;
  recurrence_until: string | null;
  description: string | null;
  image_url: string | null;
  auto_import_source_url: string | null;
  ticket_url: string | null;
  venue: { id: string; name: string; slug: string; city: { name: string; slug: string } | null } | null;
  submitter: { email: string | null; display_name: string | null } | null;
};

// Work out exactly which dates an event will appear on once approved, matching
// the public What's On filter (which keys off end_date). Returns a human label
// plus a `warn` flag for the gotcha case: a recurrence is set but there's no
// end_date, so the event will only ever show on its single start day.
function describeDates(e: PendingEvent): { text: string; warn: boolean } {
  const fmt = (d: Date) => d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
  const start = new Date(e.start_time);
  const startLabel = fmt(start);

  // Recurring series — shows on every matching day (e.g. "Every Friday").
  const rec = recurrenceLabel(e.recurrence_pattern, e.start_time);
  if (rec) {
    const until = e.recurrence_until
      ? ` until ${new Date(`${e.recurrence_until}T00:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}`
      : "";
    return { text: `${rec}${until}`, warn: false };
  }

  if (e.end_date) {
    const end = new Date(`${e.end_date}T00:00:00`);
    if (!Number.isNaN(end.getTime()) && end.toDateString() !== start.toDateString()) {
      return { text: `Every day · ${startLabel} → ${fmt(end)}`, warn: false };
    }
  }
  return { text: `${startLabel} only`, warn: false };
}

type PendingSuggestion = {
  id: string;
  venue_name: string;
  address: string | null;
  postcode: string | null;
  website: string | null;
  gig_title: string | null;
  gig_start_time: string | null;
  submitter_name: string | null;
  submitter_contact: string | null;
  created_at: string;
  city: { name: string; slug: string } | null;
  submitter: { email: string | null; display_name: string | null } | null;
};

type PendingClaim = {
  id: string;
  venue_id: string;
  claimant_user_id: string;
  role: string | null;
  business_name: string | null;
  business_type: string | null;
  contact_phone: string | null;
  contact_email: string | null;
  reason: string | null;
  created_at: string;
  venue: {
    id: string;
    name: string;
    slug: string;
    owner_id: string | null;
    city: { name: string; slug: string } | null;
  } | null;
  claimant: { email: string | null; display_name: string | null } | null;
};

type PendingVenue = {
  id: string;
  name: string;
  slug: string;
  address: string | null;
  postcode: string | null;
  owner_id: string | null;
  created_at: string;
  city: { name: string; slug: string } | null;
  owner: { email: string | null; display_name: string | null } | null;
};

type PendingOrganiser = {
  id: string;
  name: string;
  slug: string;
  bio: string | null;
  image_url: string | null;
  claimed_by: string | null;
  created_at: string;
  claimer: { email: string | null; display_name: string | null } | null;
};

type Tab = "events" | "suggestions" | "claims" | "venues" | "organisers";

export default function QueueClient({
  events,
  eventsTotal,
  suggestions,
  claims,
  venues,
  organisers,
}: {
  events: PendingEvent[];
  eventsTotal?: number;
  suggestions: PendingSuggestion[];
  claims: PendingClaim[];
  venues: PendingVenue[];
  organisers: PendingOrganiser[];
}) {
  const [tab, setTab] = useState<Tab>(
    venues.length > 0 ? "venues"
    : organisers.length > 0 ? "organisers"
    : events.length > 0 ? "events"
    : claims.length > 0 ? "claims"
    : "suggestions"
  );

  return (
    <>
      <div className="flex gap-2 mb-6 flex-wrap">
        <TabPill active={tab === "venues"} onClick={() => setTab("venues")} label="New places" count={venues.length} />
        <TabPill active={tab === "organisers"} onClick={() => setTab("organisers")} label="New organisers" count={organisers.length} />
        <TabPill active={tab === "events"} onClick={() => setTab("events")} label="Pending sessions" count={eventsTotal ?? events.length} />
        <TabPill active={tab === "claims"} onClick={() => setTab("claims")} label="Place claims" count={claims.length} />
        <TabPill active={tab === "suggestions"} onClick={() => setTab("suggestions")} label="Place suggestions" count={suggestions.length} />
      </div>

      {tab === "events" && (
        events.length === 0 ? (
          <Empty message="No pending sessions. Place owners are doing their bit. ✨" />
        ) : (
          <ul className="card divide-y divide-buzz-border/60">
            {events.map((e) => <EventRow key={e.id} event={e} />)}
          </ul>
        )
      )}

      {tab === "claims" && (
        claims.length === 0 ? (
          <Empty message="No pending place claims. ✨" />
        ) : (
          <ul className="card divide-y divide-buzz-border/60">
            {claims.map((c) => <ClaimRow key={c.id} claim={c} />)}
          </ul>
        )
      )}

      {tab === "suggestions" && (
        suggestions.length === 0 ? (
          <Empty message="No venue suggestions to review." />
        ) : (
          <ul className="card divide-y divide-buzz-border/60">
            {suggestions.map((s) => <SuggestionRow key={s.id} suggestion={s} />)}
          </ul>
        )
      )}

      {tab === "venues" && (
        venues.length === 0 ? (
          <Empty message="No new venues awaiting approval. ✨" />
        ) : (
          <ul className="card divide-y divide-buzz-border/60">
            {venues.map((v) => <PendingVenueRow key={v.id} venue={v} />)}
          </ul>
        )
      )}

      {tab === "organisers" && (
        organisers.length === 0 ? (
          <Empty message="No new organisers awaiting approval. ✨" />
        ) : (
          <ul className="card divide-y divide-buzz-border/60">
            {organisers.map((o) => <PendingOrganiserRow key={o.id} organiser={o} />)}
          </ul>
        )
      )}
    </>
  );
}

function PendingVenueRow({ venue }: { venue: PendingVenue }) {
  const [busy, startTransition] = useTransition();
  const [done, setDone] = useState(false);

  function approve() {
    startTransition(async () => {
      const r = await approveVenue(venue.id);
      if (!("error" in r)) setDone(true);
    });
  }

  if (done) {
    return (
      <li className="p-4 text-sm text-emerald-400">
        ✓ Approved {venue.name}
      </li>
    );
  }

  return (
    <li className="p-4 flex items-start gap-3">
      <div className="flex-1 min-w-0">
        <div className="font-medium truncate">{venue.name}</div>
        <div className="text-xs text-buzz-mute truncate">
          {venue.city?.name ?? "—"}
          {venue.address && <> · {venue.address}</>}
          {venue.postcode && <> · {venue.postcode}</>}
        </div>
        {venue.owner && (
          <div className="text-xs text-buzz-mute mt-0.5">
            Submitted by {venue.owner.display_name || venue.owner.email}
          </div>
        )}
      </div>
      <Link
        href={`/dashboard/venues/${venue.id}/edit`}
        target="_blank"
        className="text-xs text-buzz-mute hover:text-buzz-accent shrink-0"
      >
        Edit ↗
      </Link>
      <button
        type="button"
        onClick={approve}
        disabled={busy}
        className="btn-primary text-xs whitespace-nowrap"
      >
        {busy ? "Approving…" : "✓ Approve"}
      </button>
    </li>
  );
}

function PendingOrganiserRow({ organiser }: { organiser: PendingOrganiser }) {
  const [busy, startTransition] = useTransition();
  const [done, setDone] = useState(false);

  function approve() {
    startTransition(async () => {
      const r = await approveOrganiser(organiser.id);
      if (!("error" in r)) setDone(true);
    });
  }

  if (done) {
    return (
      <li className="p-4 text-sm text-emerald-400">
        ✓ Approved {organiser.name}
      </li>
    );
  }

  return (
    <li className="p-4 flex items-start gap-3">
      {organiser.image_url ? (
        <div
          className="w-10 h-10 rounded bg-buzz-surface shrink-0 border border-buzz-border"
          style={{
            backgroundImage: `url(${organiser.image_url})`,
            backgroundSize: "cover",
            backgroundPosition: "center",
          }}
        />
      ) : (
        <div className="w-10 h-10 rounded bg-buzz-surface shrink-0 border border-buzz-border grid place-items-center text-base">
          📋
        </div>
      )}
      <div className="flex-1 min-w-0">
        <div className="font-medium truncate">{organiser.name}</div>
        {organiser.bio && (
          <div className="text-xs text-buzz-mute line-clamp-2">{organiser.bio}</div>
        )}
        {organiser.claimer && (
          <div className="text-xs text-buzz-mute mt-0.5">
            Claimed by {organiser.claimer.display_name || organiser.claimer.email}
          </div>
        )}
      </div>
      <Link
        href={`/dashboard/organiser/${organiser.id}/edit`}
        target="_blank"
        className="text-xs text-buzz-mute hover:text-buzz-accent shrink-0"
      >
        Edit ↗
      </Link>
      <button
        type="button"
        onClick={approve}
        disabled={busy}
        className="btn-primary text-xs whitespace-nowrap"
      >
        {busy ? "Approving…" : "✓ Approve"}
      </button>
    </li>
  );
}

function ClaimRow({ claim }: { claim: PendingClaim }) {
  const [busy, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [showReject, setShowReject] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  // When the approve attempt comes back with hasExistingOwner=true, we
  // surface a one-click Transfer button instead of just an error string.
  // Admin confirms via the button, which re-runs approve with the
  // transferFromExistingOwner override.
  const [needsTransferConfirm, setNeedsTransferConfirm] = useState(false);

  function approve(opts: { transferFromExistingOwner?: boolean } = {}) {
    setError(null);
    start(async () => {
      const r = await approveVenueClaim(claim.id, opts);
      if (r && "error" in r) {
        // Show the Transfer button when the server flagged an existing
        // owner. Other errors render as plain text below.
        if ((r as any).hasExistingOwner) {
          setNeedsTransferConfirm(true);
          setError(null);
        } else {
          setError((r as { error?: string }).error ?? "Couldn't approve claim.");
          setNeedsTransferConfirm(false);
        }
      }
    });
  }
  function reject() {
    start(async () => {
      const r = await rejectVenueClaim(claim.id, rejectReason || undefined);
      if (r?.error) setError(r.error);
    });
  }

  const venueName = claim.venue?.name ?? "—";
  const claimantLabel =
    claim.claimant?.display_name ?? claim.claimant?.email ?? "anonymous claimant";

  return (
    <li className="p-4 flex flex-col gap-3">
      <div className="flex flex-col sm:flex-row sm:items-start gap-3 sm:justify-between">
        <div className="min-w-0 flex-1">
          <div className="font-medium">
            {venueName}
            {claim.venue?.city && (
              <span className="text-buzz-mute"> · {claim.venue.city.name}</span>
            )}
          </div>
          <div className="text-xs text-buzz-mute mt-0.5">
            {claimantLabel} ({claim.claimant?.email ?? claim.contact_email ?? "no email"})
            {claim.contact_phone ? ` · ${claim.contact_phone}` : ""}
          </div>
          {(claim.business_name || claim.business_type) && (
            <div className="text-xs text-buzz-mute mt-0.5">
              {claim.business_name ? `🏢 ${claim.business_name}` : ""}
              {claim.business_type ? ` · ${BUSINESS_TYPE_LABEL[claim.business_type] ?? claim.business_type}` : ""}
            </div>
          )}
          {claim.reason && (
            <p className="text-sm text-buzz-text/90 mt-2 whitespace-pre-line">
              {claim.reason}
            </p>
          )}
          <div className="text-[11px] text-buzz-mute mt-2">
            Submitted {new Date(claim.created_at).toLocaleString()}
          </div>
          {error && <div className="text-xs text-rose-400 mt-1">{error}</div>}
          {needsTransferConfirm && (
            <div className="text-xs text-amber-300 mt-2 rounded-md bg-amber-500/10 border border-amber-500/40 px-3 py-2">
              <strong>Venue already has an owner.</strong> If this claim is
              legitimate (e.g. the previous owner was a setup-wizard stub or an
              abandoned account), click <strong>Transfer ownership</strong> below
              to reassign the venue to {claimantLabel}. The previous owner loses
              dashboard access but their account stays intact.
            </div>
          )}
        </div>
        <div className="flex items-center gap-2 flex-wrap shrink-0">
          {claim.venue && (
            <Link
              href={`/${claim.venue.city?.slug ?? "dundee"}/venues/${claim.venue.slug}`}
              target="_blank"
              className="btn-ghost text-xs"
            >
              View venue
            </Link>
          )}
          {needsTransferConfirm ? (
            <>
              <button
                onClick={() => approve({ transferFromExistingOwner: true })}
                disabled={busy}
                className="btn-primary bg-amber-500 hover:bg-amber-400 text-black"
                title="Replace the venue's current owner with this claimant"
              >
                {busy ? "…" : "Transfer ownership"}
              </button>
              <button
                onClick={() => { setNeedsTransferConfirm(false); setError(null); }}
                disabled={busy}
                className="btn-ghost text-xs"
              >
                Cancel
              </button>
            </>
          ) : (
            <button onClick={() => approve()} disabled={busy} className="btn-primary">
              {busy ? "…" : "Approve"}
            </button>
          )}
          <button
            onClick={() => setShowReject((s) => !s)}
            disabled={busy}
            className="btn-secondary"
          >
            Reject
          </button>
        </div>
      </div>

      {showReject && (
        <div className="rounded-lg border border-buzz-border bg-buzz-surface/40 p-3 flex flex-col gap-2">
          <input
            type="text"
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            placeholder="Optional reason — emailed to the claimant"
            maxLength={500}
            className="rounded-md bg-buzz-card border border-buzz-border px-3 py-2 text-sm"
          />
          <div className="flex gap-2 justify-end">
            <button
              onClick={() => { setShowReject(false); setRejectReason(""); }}
              className="btn-ghost"
              disabled={busy}
            >
              Cancel
            </button>
            <button onClick={reject} disabled={busy} className="btn-danger">
              {busy ? "…" : "Confirm reject"}
            </button>
          </div>
        </div>
      )}
    </li>
  );
}

function TabPill({ active, onClick, label, count }: { active: boolean; onClick: () => void; label: string; count: number }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        active
          ? "px-4 py-2 rounded-full font-semibold bg-buzz-accent text-black"
          : "px-4 py-2 rounded-full bg-buzz-card border border-buzz-border hover:border-buzz-accent transition"
      }
    >
      {label} <span className={active ? "opacity-70" : "text-buzz-mute"}>({count})</span>
    </button>
  );
}

function Empty({ message }: { message: string }) {
  return <div className="card p-10 text-buzz-mute text-center">{message}</div>;
}

function EventRow({ event: e }: { event: PendingEvent }) {
  const [pending, start] = useTransition();
  const [done, setDone] = useState<"approved" | "rejected" | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (done) {
    return (
      <li className="px-4 py-3 text-sm text-buzz-mute">
        {done === "approved" ? "Approved" : "Rejected"}: {e.title}
      </li>
    );
  }

  const when = new Date(e.start_time);
  const dateLabel = when.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
  const timeLabel = when.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  const shows = describeDates(e);

  return (
    <li className="px-4 py-4">
      <div className="flex items-start gap-3">
        {e.image_url ? (
          <div
            className="w-14 h-14 rounded-lg bg-buzz-surface shrink-0"
            style={{ backgroundImage: `url(${e.image_url})`, backgroundSize: "cover", backgroundPosition: "center" }}
          />
        ) : (
          <div className="w-14 h-14 rounded-lg bg-buzz-surface border border-buzz-border grid place-items-center text-2xl shrink-0">🎪</div>
        )}
        <div className="flex-1 min-w-0">
          <div className="font-semibold truncate">{e.title}</div>
          <div className="text-xs text-buzz-mute">
            {dateLabel} · {timeLabel} · {e.venue?.name ?? "—"} · {e.venue?.city?.name ?? "—"}
          </div>
          <div className="mt-1.5">
            <span
              className={
                "inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium border " +
                (shows.warn
                  ? "bg-amber-500/10 text-amber-600 border-amber-500/40"
                  : "bg-buzz-accent/10 text-buzz-accent border-buzz-accent/30")
              }
              title="Which dates this will appear on once approved"
            >
              {shows.warn ? "⚠️" : "📅"} Shows on: {shows.text}
            </span>
          </div>
          {e.submitter && (
            <div className="text-xs text-buzz-mute mt-1">
              Submitted by {e.submitter.display_name ?? e.submitter.email ?? "anonymous"}
            </div>
          )}
          {e.description && (
            <p className="text-sm text-buzz-text/80 mt-2 line-clamp-2">{e.description}</p>
          )}
          {(() => {
            const src = e.auto_import_source_url || e.ticket_url;
            if (!src) return null;
            let host = src;
            try { host = new URL(src).hostname.replace(/^www\./, ""); } catch {}
            return (
              <a
                href={src}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-xs text-buzz-accent hover:underline mt-2"
                title="Open the page this was scraped from to double-check"
              >
                🔗 Check source ({host}) ↗
              </a>
            );
          })()}
        </div>
        <div className="flex flex-col gap-1.5 items-end shrink-0">
          <button
            type="button"
            disabled={pending}
            className="btn-primary !py-1.5 !px-3 text-xs"
            onClick={() => start(async () => {
              const r = await approveEvent(e.id);
              if (r?.error) setError(r.error);
              else setDone("approved");
            })}
          >
            {pending ? "…" : "Approve"}
          </button>
          <button
            type="button"
            disabled={pending}
            className="btn-danger !py-1.5 !px-3 text-xs"
            onClick={() => start(async () => {
              const r = await rejectEvent(e.id);
              if (r?.error) setError(r.error);
              else setDone("rejected");
            })}
          >
            Reject
          </button>
        </div>
      </div>
      {error && <div className="text-xs text-rose-400 mt-2">{error}</div>}
    </li>
  );
}

function SuggestionRow({ suggestion: s }: { suggestion: PendingSuggestion }) {
  const [pending, start] = useTransition();
  const [done, setDone] = useState<"dismissed" | "deleted" | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (done) {
    return (
      <li className="px-4 py-3 text-sm text-buzz-mute">
        {done === "dismissed" ? "Dismissed" : "Deleted"}: {s.venue_name}
      </li>
    );
  }

  const dateLabel = s.gig_start_time
    ? new Date(s.gig_start_time).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })
    : null;

  return (
    <li className="px-4 py-4">
      <div className="flex items-start gap-3">
        <div className="w-12 h-12 rounded-lg bg-buzz-surface border border-buzz-border grid place-items-center text-2xl shrink-0">📍</div>
        <div className="flex-1 min-w-0">
          <div className="font-semibold truncate">{s.venue_name}</div>
          <div className="text-xs text-buzz-mute">
            {[s.city?.name, s.address, s.postcode].filter(Boolean).join(" · ") || "No location given"}
          </div>
          {s.website && (
            <a href={s.website} target="_blank" rel="noreferrer" className="text-xs text-buzz-accent hover:text-buzz-accent2">
              {s.website}
            </a>
          )}
          {s.gig_title && (
            <div className="text-sm mt-1 text-buzz-text/80">
              <strong>{s.gig_title}</strong>{dateLabel && ` · ${dateLabel}`}
            </div>
          )}
          <div className="text-xs text-buzz-mute mt-1">
            From {s.submitter?.display_name ?? s.submitter?.email ?? "anon"}
            {s.submitter_contact && <> · contact: {s.submitter_contact}</>}
          </div>
        </div>
        <div className="flex flex-col gap-1.5 items-end shrink-0">
          <button
            type="button"
            disabled={pending}
            className="btn-secondary !py-1.5 !px-3 text-xs"
            onClick={() => start(async () => {
              const r = await dismissSuggestion(s.id);
              if (r?.error) setError(r.error);
              else setDone("dismissed");
            })}
          >
            Dismiss
          </button>
          <button
            type="button"
            disabled={pending}
            className="btn-danger !py-1.5 !px-3 text-xs"
            onClick={() => {
              if (!confirm(`Delete suggestion for ${s.venue_name}?`)) return;
              start(async () => {
                const r = await deleteSuggestion(s.id);
                if (r?.error) setError(r.error);
                else setDone("deleted");
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
