"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { Event, Genre } from "@/lib/types";
import { createEvent, updateEvent, deleteEvent, duplicateEvent, repeatEvent } from "./actions";
import ImageUploader from "@/components/ImageUploader";
import ArtistTagger, { type ArtistTag } from "@/components/ArtistTagger";

// Pre-fill the <datetime-local> with the UK (Europe/London) wall-clock,
// explicitly — not the machine timezone — so the value is identical whether
// this renders on the server (UTC) or the client, and matches what the
// server action parses back. (Stops 1pm showing as 12pm and round-tripping wrong.)
function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London", hour12: false,
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
  }).formatToParts(d);
  const g = (t: string) => parts.find((p) => p.type === t)!.value;
  const hour = g("hour") === "24" ? "00" : g("hour");
  return `${g("year")}-${g("month")}-${g("day")}T${hour}:${g("minute")}`;
}

export default function EventForm({
  mode,
  event,
  genres,
  eventGenreIds,
  initialArtists = [],
  venueId,
}: {
  mode: "create" | "edit";
  event: Event | null;
  genres: Genre[];
  eventGenreIds: string[];
  initialArtists?: ArtistTag[];
  venueId: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [deleting, setDeleting] = useTransition();
  const [duping, setDuping] = useTransition();
  const [repeating, setRepeating] = useTransition();
  const [repeatWeeks, setRepeatWeeks] = useState(4);
  // Edit mode: optional target date for "Duplicate" (empty = next week).
  const [dupDate, setDupDate] = useState("");
  // Create mode only: whether to also bulk-create copies on submit. The
  // edit mode "Repeat weekly" widget is a separate, manually-triggered
  // action below — they don't share state.
  const [alsoRepeatOnCreate, setAlsoRepeatOnCreate] = useState(false);
  const [info, setInfo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [imageUrl, setImageUrl] = useState(event?.image_url ?? "");
  const [selectedGenres, setSelectedGenres] = useState<Set<string>>(new Set(eventGenreIds));
  const [artistTags, setArtistTags] = useState<ArtistTag[]>(initialArtists);

  function toggleGenre(id: string) {
    setSelectedGenres((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const fd = new FormData(e.currentTarget);
    fd.delete("genres");
    selectedGenres.forEach((id) => fd.append("genres", id));
    fd.delete("artist_ids");
    fd.delete("new_artist_names");
    artistTags.forEach((t) => {
      if (t.kind === "existing") fd.append("artist_ids", t.id);
      else fd.append("new_artist_names", t.name);
    });
    fd.set("image_url", imageUrl);
    if (mode === "create" && alsoRepeatOnCreate) {
      fd.set("repeat_weeks", String(repeatWeeks));
    }
    start(async () => {
      const action = mode === "create"
        ? (data: FormData) => createEvent(venueId, data)
        : (data: FormData) => updateEvent(event!.id, data);
      const res = await action(fd);
      if (res?.error) setError(res.error);
      else if (mode === "edit") router.refresh();
    });
  }

  function onDelete() {
    if (!event) return;
    if (!confirm("Delete this event? This cannot be undone.")) return;
    setDeleting(async () => {
      const res = await deleteEvent(event.id);
      if (res?.error) setError(res.error);
    });
  }

  return (
    <form onSubmit={onSubmit} className="card p-6 grid sm:grid-cols-2 gap-4">
      <div className="sm:col-span-2">
        <label className="label">Title *</label>
        <input className="input" name="title" required defaultValue={event?.title ?? ""} placeholder="The Vegan Leather + support" />
      </div>

      <div>
        <label className="label">Start *</label>
        <input className="input" name="start_time" type="datetime-local" required defaultValue={toLocalInput(event?.start_time)} />
      </div>
      <div>
        <label className="label">End (optional)</label>
        <input className="input" name="end_time" type="datetime-local" defaultValue={toLocalInput(event?.end_time)} />
      </div>

      <div className="sm:col-span-2">
        <label className="label">
          Runs until <span className="text-buzz-mute font-normal">(optional — last day of a multi-day run)</span>
        </label>
        <input
          className="input sm:max-w-xs"
          name="end_date"
          type="date"
          defaultValue={(event as any)?.end_date ?? ""}
        />
        <p className="help">
          For something on daily or most days — an exhibition, a holiday trail — set the last day and it
          shows in What&apos;s On on <strong>every day</strong> of its run. No need to create daily copies.
        </p>
      </div>

      <div>
        <label className="label">Cover charge</label>
        <input className="input" name="cover_charge" defaultValue={event?.cover_charge ?? ""} placeholder="Free / £5 / £10 advance, £12 door" />
      </div>
      <div>
        <label className="label">Ticket link</label>
        <input className="input" name="ticket_url" type="url" defaultValue={event?.ticket_url ?? ""} placeholder="https://" />
      </div>

      <div className="sm:col-span-2">
        <label className="label">Description</label>
        <textarea className="input min-h-[120px]" name="description" defaultValue={event?.description ?? ""} placeholder="Set times, support acts, anything fans should know." />
      </div>

      <div className="sm:col-span-2">
        <label className="label">Genres</label>
        <p className="help mb-2">Pick one or more — fans can filter by any of these.</p>
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
        <label className="label">Performers <span className="text-buzz-mute font-normal">(optional)</span></label>
        <ArtistTagger initial={initialArtists} onChange={setArtistTags} />
        <p className="help">Acts, entertainers or groups appearing — e.g. a magician, a band or a dance troupe. Press Enter (or click "Create") to add a new one.</p>
      </div>

      <div className="sm:col-span-2">
        <label className="label">Event poster / photo</label>
        <ImageUploader folder="events" value={imageUrl} onChange={setImageUrl} />
      </div>

      {mode === "edit" && (
        <div className="sm:col-span-2">
          <label className="inline-flex items-center gap-2 text-sm">
            <input type="checkbox" name="cancelled" defaultChecked={event?.cancelled ?? false} />
            Cancelled
          </label>
        </div>
      )}

      {mode === "create" && (
        <div className="sm:col-span-2 rounded-lg border border-buzz-border/60 bg-buzz-surface/30 p-3">
          <label className="inline-flex items-center gap-2 text-sm cursor-pointer select-none">
            <input
              type="checkbox"
              checked={alsoRepeatOnCreate}
              onChange={(e) => setAlsoRepeatOnCreate(e.target.checked)}
              className="accent-buzz-accent"
            />
            <span>Also create copies of this event for the next</span>
            <input
              type="number"
              min={1}
              max={52}
              value={repeatWeeks}
              onChange={(e) => setRepeatWeeks(parseInt(e.target.value || "1"))}
              onClick={(e) => e.stopPropagation()}
              disabled={!alsoRepeatOnCreate}
              className="w-14 bg-buzz-surface border border-buzz-border rounded px-2 py-0.5 text-center disabled:opacity-50"
            />
            <span>weeks</span>
          </label>
          <p className="help mt-1.5">
            Same title, artists, genres, poster — just bumped 7 days at a time. Handy for weekly residencies, quiz nights, open mics.
          </p>
        </div>
      )}

      {error && <div className="sm:col-span-2 text-sm text-rose-400">{error}</div>}
      {info && <div className="sm:col-span-2 text-sm text-emerald-400">{info}</div>}

      <div className="sm:col-span-2 flex flex-wrap gap-2">
        <button type="submit" className="btn-primary" disabled={pending}>
          {pending
            ? "Saving…"
            : mode === "create"
            ? alsoRepeatOnCreate
              ? `Add event + ${repeatWeeks} ${repeatWeeks === 1 ? "copy" : "copies"}`
              : "Add event"
            : "Save changes"}
        </button>
        {mode === "edit" && (
          <button type="button" onClick={onDelete} className="btn-danger" disabled={deleting}>
            {deleting ? "Deleting…" : "Delete"}
          </button>
        )}
      </div>

      {mode === "edit" && event && (
        <div className="sm:col-span-2 mt-2 pt-5 border-t border-buzz-border/60 flex flex-col gap-4">
          <div>
            <p className="eyebrow text-[10px] mb-2">Save time</p>
            <div className="flex flex-wrap gap-2 items-center">
              <div className="inline-flex items-center gap-2 rounded-lg bg-buzz-card border border-buzz-border px-3 py-1.5 text-sm">
                <span className="text-buzz-mute">📄 Copy to</span>
                <input
                  type="date"
                  value={dupDate}
                  onChange={(e) => setDupDate(e.target.value)}
                  className="bg-buzz-surface border border-buzz-border rounded px-2 py-0.5"
                  title="Pick the date for the copy — leave empty for next week"
                />
                <button
                  type="button"
                  disabled={duping}
                  onClick={() => {
                    setError(null); setInfo(null);
                    setDuping(async () => {
                      const r = await duplicateEvent(event.id, dupDate || undefined);
                      if (r?.error) setError(r.error);
                    });
                  }}
                  className="btn-secondary !py-1.5 !px-3"
                >
                  {duping ? "Duplicating…" : dupDate ? "Duplicate" : "Duplicate (next week)"}
                </button>
              </div>

              <div className="inline-flex items-center gap-2 rounded-lg bg-buzz-card border border-buzz-border px-3 py-1.5 text-sm">
                <span className="text-buzz-mute">Repeat weekly for</span>
                <input
                  type="number"
                  min={1}
                  max={52}
                  value={repeatWeeks}
                  onChange={(e) => setRepeatWeeks(parseInt(e.target.value || "1"))}
                  className="w-14 bg-buzz-surface border border-buzz-border rounded px-2 py-0.5 text-center"
                />
                <span className="text-buzz-mute">weeks</span>
                <button
                  type="button"
                  disabled={repeating}
                  onClick={() => {
                    setError(null); setInfo(null);
                    setRepeating(async () => {
                      const r = await repeatEvent(event.id, repeatWeeks);
                      if ("error" in r) {
                        setError(r.error);
                      } else {
                        setInfo(`Created ${r.created} new gigs.`);
                        router.refresh();
                      }
                    });
                  }}
                  className="btn-primary !py-1.5 !px-3"
                >
                  {repeating ? "…" : "Go"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </form>
  );
}
