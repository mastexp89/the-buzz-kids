"use client";

import Link from "next/link";
import { Fragment, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  approveVenue,
  unapproveVenue,
  deleteVenueAdmin,
  messageVenueOwner,
} from "./actions";

export default function AdminVenueRow({
  venue,
  pending,
  selected,
  onToggleSelect,
}: {
  venue: any;
  pending?: boolean;
  selected?: boolean;
  onToggleSelect?: () => void;
}) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [messageOpen, setMessageOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [sentOk, setSentOk] = useState(false);

  function approve() {
    start(async () => {
      const r = await approveVenue(venue.id);
      if (r?.error) setError(r.error);
      else router.refresh();
    });
  }
  function unapprove() {
    start(async () => {
      const r = await unapproveVenue(venue.id);
      if (r?.error) setError(r.error);
      else router.refresh();
    });
  }
  function destroy() {
    const confirmed = confirm(
      `Delete "${venue.name}" permanently?\n\n` +
        `This will also delete all of its gigs, genre tags and artist links. ` +
        `Cannot be undone.\n\n` +
        `If you just want to take it offline, use Unapprove instead.`,
    );
    if (!confirmed) return;
    start(async () => {
      const r = await deleteVenueAdmin(venue.id);
      if (r?.error) setError(r.error);
      else router.refresh();
    });
  }

  function sendMessage() {
    setError(null);
    setSentOk(false);
    start(async () => {
      const r = await messageVenueOwner(venue.id, subject, body);
      if (r?.error) {
        setError(r.error);
      } else {
        setSentOk(true);
        setSubject("");
        setBody("");
        setTimeout(() => {
          setMessageOpen(false);
          setSentOk(false);
        }, 1500);
      }
    });
  }

  const ownerEmail = venue.owner?.email as string | undefined;
  const charsLeft = 10000 - body.length;

  // Friendly day-of-week order for the opening hours grid
  const DAY_KEYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
  const DAY_LABELS: Record<string, string> = {
    mon: "Mon", tue: "Tue", wed: "Wed", thu: "Thu",
    fri: "Fri", sat: "Sat", sun: "Sun",
  };
  const openingJson =
    (venue.opening_hours_json as Record<string, { open: string; close: string }> | null) || null;

  // Which social columns might be populated
  const SOCIAL_FIELDS: { key: string; label: string }[] = [
    { key: "facebook", label: "Facebook" },
    { key: "instagram", label: "Instagram" },
    { key: "twitter", label: "Twitter" },
    { key: "tiktok", label: "TikTok" },
    { key: "youtube", label: "YouTube" },
    { key: "spotify", label: "Spotify" },
  ];
  const populatedSocials = SOCIAL_FIELDS.filter((s) => venue[s.key]);

  const galleryUrls = (venue.gallery_image_urls as string[] | null) ?? [];
  const photoRefs = (venue.photo_refs as string[] | null) ?? [];
  const isAutoImported = !!venue.auto_imported;

  return (
    <li
      className={
        "p-4 flex flex-col gap-3 transition-colors " +
        (selected ? "bg-buzz-accent/5" : "")
      }
    >
      <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:justify-between">
        <div className="flex items-start gap-2 min-w-0">
          {onToggleSelect && (
            <input
              type="checkbox"
              checked={!!selected}
              onChange={onToggleSelect}
              className="shrink-0 mt-1.5 w-4 h-4 accent-buzz-accent"
              aria-label={`Select ${venue.name}`}
            />
          )}
          <button
            type="button"
            onClick={() => setExpanded((e) => !e)}
            className="shrink-0 mt-0.5 p-1 rounded hover:bg-buzz-surface/50 text-buzz-mute hover:text-buzz-text transition-colors"
            aria-label={expanded ? "Collapse details" : "Expand details"}
            title={expanded ? "Collapse details" : "Expand details"}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{
                transform: expanded ? "rotate(90deg)" : "rotate(0deg)",
                transition: "transform 0.15s ease",
              }}
            >
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </button>
          <div className="min-w-0">
            <div className="font-medium truncate flex items-center gap-2">
              {venue.name}
              {isAutoImported && (
                <span className="text-[10px] uppercase tracking-wide bg-buzz-accent/15 text-buzz-accent px-1.5 py-0.5 rounded">
                  Auto-imported
                </span>
              )}
            </div>
            <div className="text-xs text-buzz-mute">
              {venue.city?.name ?? "—"}
              {ownerEmail ? ` · ${ownerEmail}` : ""}
              {!ownerEmail && isAutoImported ? " · Unclaimed" : ""}
            </div>
            {venue.address && (
              <div className="text-xs text-buzz-mute truncate">
                {venue.address}
                {venue.postcode ? ` · ${venue.postcode}` : ""}
              </div>
            )}
            {error && (
              <div className="text-xs text-rose-400 mt-1">{error}</div>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {venue.approved && (
            <Link
              href={`/${venue.city?.slug ?? "dundee"}/venues/${venue.slug}`}
              className="btn-ghost"
              target="_blank"
            >
              View
            </Link>
          )}
          <Link
            href={`/dashboard/venues/${venue.id}/events/new`}
            className="btn-secondary"
          >
            + Add event
          </Link>
          <Link
            href={`/dashboard/venues/${venue.id}/edit`}
            className="btn-secondary"
          >
            Edit
          </Link>
          <Link
            href={`/admin/venues/${venue.id}/promote`}
            className="btn-secondary"
            title="Comp a promotion for this venue"
          >
            Promote
          </Link>
          <button
            type="button"
            onClick={() => {
              setMessageOpen((o) => !o);
              setError(null);
              setSentOk(false);
            }}
            className="btn-secondary"
            disabled={!ownerEmail}
            title={
              ownerEmail
                ? `Email the venue owner at ${ownerEmail}`
                : "No owner email on file"
            }
          >
            {messageOpen ? "Close" : "Message"}
          </button>
          {pending ? (
            <button
              onClick={approve}
              disabled={busy}
              className="btn-primary"
            >
              {busy ? "…" : "Approve"}
            </button>
          ) : (
            <button
              onClick={unapprove}
              disabled={busy}
              className="btn-secondary"
            >
              {busy ? "…" : "Unapprove"}
            </button>
          )}
          <button
            onClick={destroy}
            disabled={busy}
            className="btn-danger"
            title="Permanently delete venue and all its gigs"
          >
            {busy ? "…" : "Delete"}
          </button>
        </div>
      </div>

      {expanded && (
        <div className="rounded-lg border border-buzz-border bg-buzz-surface/40 p-4 grid sm:grid-cols-2 gap-x-6 gap-y-4 text-sm">
          {venue.description && (
            <div className="sm:col-span-2">
              <div className="text-[10px] uppercase tracking-wide text-buzz-mute mb-1">
                Description
              </div>
              <p className="text-buzz-text leading-relaxed">{venue.description}</p>
            </div>
          )}

          <div>
            <div className="text-[10px] uppercase tracking-wide text-buzz-mute mb-2">
              Contact
            </div>
            <div className="flex flex-col gap-1">
              {venue.phone && (
                <a href={`tel:${venue.phone}`} className="text-buzz-text hover:text-buzz-accent">
                  📞 {venue.phone}
                </a>
              )}
              {venue.email && (
                <a href={`mailto:${venue.email}`} className="text-buzz-text hover:text-buzz-accent break-all">
                  ✉️ {venue.email}
                </a>
              )}
              {venue.website && (
                <a
                  href={venue.website}
                  target="_blank"
                  rel="noreferrer"
                  className="text-buzz-text hover:text-buzz-accent break-all"
                >
                  🌐 {venue.website.replace(/^https?:\/\//, "")}
                </a>
              )}
              {!venue.phone && !venue.email && !venue.website && (
                <span className="text-buzz-mute italic text-xs">No contact info</span>
              )}
            </div>
          </div>

          <div>
            <div className="text-[10px] uppercase tracking-wide text-buzz-mute mb-2">
              Opening hours
            </div>
            {openingJson ? (
              <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
                {DAY_KEYS.map((d) => {
                  const h = openingJson[d];
                  return (
                    <Fragment key={d}>
                      <span className="text-buzz-mute">{DAY_LABELS[d]}</span>
                      <span className="text-buzz-text">
                        {h ? `${h.open} – ${h.close}` : <span className="text-buzz-mute">Closed</span>}
                      </span>
                    </Fragment>
                  );
                })}
              </div>
            ) : venue.opening_hours ? (
              <div className="text-xs text-buzz-text whitespace-pre-line">
                {String(venue.opening_hours).split(" | ").join("\n")}
              </div>
            ) : (
              <span className="text-buzz-mute italic text-xs">No hours set</span>
            )}
          </div>

          {populatedSocials.length > 0 && (
            <div>
              <div className="text-[10px] uppercase tracking-wide text-buzz-mute mb-2">
                Socials
              </div>
              <div className="flex flex-wrap gap-2">
                {populatedSocials.map((s) => (
                  <a
                    key={s.key}
                    href={venue[s.key]}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs px-2 py-1 rounded border border-buzz-border hover:border-buzz-accent hover:text-buzz-accent transition-colors"
                  >
                    {s.label}
                  </a>
                ))}
              </div>
            </div>
          )}

          <div>
            <div className="text-[10px] uppercase tracking-wide text-buzz-mute mb-2">
              Photos
            </div>
            {galleryUrls.length > 0 ? (
              <div className="flex gap-2 flex-wrap">
                {galleryUrls.slice(0, 4).map((url, i) => (
                  <img
                    key={i}
                    src={url}
                    alt=""
                    className="w-16 h-16 object-cover rounded border border-buzz-border"
                  />
                ))}
                {galleryUrls.length > 4 && (
                  <div className="w-16 h-16 rounded border border-buzz-border flex items-center justify-center text-xs text-buzz-mute">
                    +{galleryUrls.length - 4}
                  </div>
                )}
              </div>
            ) : photoRefs.length > 0 ? (
              <span className="text-xs text-buzz-mute italic">
                {photoRefs.length} Google photo{photoRefs.length === 1 ? "" : "s"} ready to download
              </span>
            ) : (
              <span className="text-buzz-mute italic text-xs">No photos</span>
            )}
          </div>

          {(venue.google_rating || venue.google_maps_uri || venue.latitude) && (
            <div className="sm:col-span-2 pt-2 border-t border-buzz-border/50">
              <div className="text-[10px] uppercase tracking-wide text-buzz-mute mb-2">
                Google data
              </div>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-buzz-mute">
                {venue.google_rating && (
                  <span>
                    ⭐ {Number(venue.google_rating).toFixed(1)}
                    {venue.google_rating_count
                      ? ` (${venue.google_rating_count} reviews)`
                      : ""}
                  </span>
                )}
                {venue.google_maps_uri && (
                  <a
                    href={venue.google_maps_uri}
                    target="_blank"
                    rel="noreferrer"
                    className="hover:text-buzz-accent"
                  >
                    🗺 Open in Google Maps
                  </a>
                )}
                {venue.latitude != null && venue.longitude != null && (
                  <span>
                    📍 {Number(venue.latitude).toFixed(5)}, {Number(venue.longitude).toFixed(5)}
                  </span>
                )}
                {venue.slug && (
                  <span className="font-mono text-[11px] break-all">
                    /{venue.city?.slug ?? "dundee"}/venues/{venue.slug}
                  </span>
                )}
                {venue.import_source && (
                  <span className="font-mono text-[11px]">{venue.import_source}</span>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {messageOpen && (
        <div className="rounded-lg border border-buzz-border bg-buzz-surface/40 p-4 flex flex-col gap-3">
          <div className="text-xs text-buzz-mute">
            Sending to <span className="text-buzz-text">{ownerEmail}</span>.
            Replies will go to{" "}
            <span className="text-buzz-text">admin@thebuzzguide.co.uk</span>.
          </div>
          <input
            type="text"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="Subject"
            maxLength={200}
            className="rounded-md bg-buzz-card border border-buzz-border px-3 py-2 text-sm"
          />
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder={`Hi ${
              venue.owner?.display_name ?? "there"
            },\n\n…`}
            rows={6}
            maxLength={10000}
            className="rounded-md bg-buzz-card border border-buzz-border px-3 py-2 text-sm leading-relaxed"
          />
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-buzz-mute">
              {charsLeft.toLocaleString()} chars left
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => {
                  setMessageOpen(false);
                  setSubject("");
                  setBody("");
                  setError(null);
                  setSentOk(false);
                }}
                className="btn-ghost"
                disabled={busy}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={sendMessage}
                className="btn-primary"
                disabled={
                  busy ||
                  !subject.trim() ||
                  !body.trim() ||
                  !ownerEmail
                }
              >
                {busy ? "Sending…" : "Send email"}
              </button>
            </div>
          </div>
          {sentOk && (
            <div className="text-xs text-emerald-400">Sent ✓</div>
          )}
        </div>
      )}
    </li>
  );
}
