"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  extractFestivalPosterDrafts,
  publishFestivalPosterDrafts,
  createVenueForFestival,
  type FestivalDraftEvent,
} from "./actions";

// Sentinel value for the "create from poster hint" dropdown option.
// Anything else is either "" (no choice) or a real venue id.
const CREATE_SENTINEL = "__create__";

type VenueOption = { id: string; name: string; city: string | null };

type DraftWithLocal = FestivalDraftEvent & {
  selected: boolean;
  posterImageUrl: string;
};

function toLocalLabel(iso: string, endIso?: string | null): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const date = d.toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
  const startTime = d.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
  });
  if (!endIso) return `${date}, ${startTime}`;
  const e = new Date(endIso);
  if (Number.isNaN(e.getTime())) return `${date}, ${startTime}`;
  const endTime = e.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
  });
  // Same-day range: "Sun 31 May, 16:00 – 19:00"
  // Cross-day range: "Sun 31 May 22:00 – Mon 1 Jun 02:00"
  const endDate = e.toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
  if (endDate === date) return `${date}, ${startTime} – ${endTime}`;
  return `${date} ${startTime} – ${endDate} ${endTime}`;
}

export default function PosterUploadClient({
  festivalId,
  festivalName,
}: {
  festivalId: string;
  festivalName: string;
}) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [supabase] = useState(() => createClient());

  const [drafts, setDrafts] = useState<DraftWithLocal[]>([]);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const [publishing, startPublish] = useTransition();
  const [venueOptions, setVenueOptions] = useState<VenueOption[]>([]);

  // Pull the venue list once for the dropdown when AI didn't match.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("venues")
        .select("id, name, city:cities(name)")
        .eq("approved", true)
        .order("name");
      if (cancelled) return;
      setVenueOptions(
        (data ?? []).map((v: any) => ({
          id: v.id,
          name: v.name,
          city: v.city?.name ?? null,
        })),
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [supabase]);

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setError(null);
    setInfo(null);
    setReading(true);
    setProgress(`Reading poster 1 of ${files.length}…`);

    const newDrafts: DraftWithLocal[] = [];
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setError("Not signed in.");
        return;
      }

      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        setProgress(`Uploading poster ${i + 1} of ${files.length}…`);

        const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
        const path = `festivals/${festivalId}/posters/${Date.now()}-${i}.${ext}`;
        const { error: upErr } = await supabase.storage
          .from("media")
          .upload(path, file, {
            upsert: false,
            contentType: file.type || "image/jpeg",
          });
        if (upErr) {
          setError(`Upload failed: ${upErr.message}`);
          return;
        }
        const { data } = supabase.storage.from("media").getPublicUrl(path);
        const posterUrl = data.publicUrl;

        setProgress(`Reading gigs from poster ${i + 1} of ${files.length}…`);
        const res = await extractFestivalPosterDrafts({
          festivalId,
          imageUrl: posterUrl,
        });
        if ("error" in res) {
          setError(res.error);
          return;
        }
        for (const d of res.drafts) {
          newDrafts.push({
            ...d,
            selected: true,
            posterImageUrl: posterUrl,
          });
        }
      }
      setDrafts((prev) => [...prev, ...newDrafts]);
      if (newDrafts.length === 0) {
        setInfo("AI couldn't pull anything event-shaped from those posters.");
      }
    } finally {
      setReading(false);
      setProgress(null);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  function updateDraft(i: number, patch: Partial<DraftWithLocal>) {
    setDrafts((ds) => ds.map((d, idx) => (idx === i ? { ...d, ...patch } : d)));
  }

  function removeDraft(i: number) {
    setDrafts((ds) => ds.filter((_, idx) => idx !== i));
  }

  function publish() {
    setError(null);
    setInfo(null);
    const selected = drafts.filter((d) => d.selected && d.matchedVenueId);
    const skipped = drafts.filter((d) => d.selected && !d.matchedVenueId);
    if (selected.length === 0) {
      setError(
        skipped.length > 0
          ? "Every selected draft is missing a venue match — pick a venue for each before publishing."
          : "Tick at least one event to publish.",
      );
      return;
    }

    startPublish(async () => {
      const res = await publishFestivalPosterDrafts({
        festivalId,
        drafts: selected.map((d) => ({
          title: d.title,
          starts_at: d.starts_at,
          ends_at: d.ends_at,
          description: d.description,
          venueId: d.matchedVenueId as string,
          genres: d.genres,
          artists: d.artists ?? [],
        })),
      });
      if ("error" in res) {
        setError(res.error);
        return;
      }
      setInfo(
        `✓ Created ${res.created} ${res.created === 1 ? "event" : "events"}, attached to ${festivalName}.${
          skipped.length > 0 ? ` ${skipped.length} skipped (no venue match).` : ""
        }`,
      );
      // Drop the drafts we just published
      setDrafts((ds) => ds.filter((d) => !d.selected || !d.matchedVenueId));
      router.refresh();
    });
  }

  const allSelected = drafts.length > 0 && drafts.every((d) => d.selected);
  const matchedCount = drafts.filter((d) => d.selected && d.matchedVenueId).length;
  const unmatchedCount = drafts.filter((d) => d.selected && !d.matchedVenueId).length;

  return (
    <div className="flex flex-col gap-4">
      <div className="card p-4 flex flex-col gap-3">
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={reading || publishing}
          className="w-full aspect-[16/4] rounded-lg border-2 border-dashed border-buzz-border bg-buzz-surface/50 hover:bg-buzz-surface text-buzz-mute hover:text-buzz-text transition flex flex-col items-center justify-center gap-2"
        >
          <span className="text-4xl">📸</span>
          <span className="text-sm font-medium">
            {reading ? progress ?? "Reading…" : "Drop a poster (or several) — AI reads the rest"}
          </span>
          <span className="text-[10px] uppercase tracking-wider text-buzz-mute/70">
            JPG / PNG, up to 10 MB each
          </span>
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(e) => handleFiles(e.target.files)}
        />
        {error && <div className="text-sm text-rose-400">{error}</div>}
        {info && <div className="text-sm text-emerald-400">{info}</div>}
      </div>

      {drafts.length > 0 && (
        <>
          <div className="flex items-center justify-between flex-wrap gap-3">
            <p className="eyebrow">
              Preview · {drafts.length} {drafts.length === 1 ? "draft" : "drafts"}
              <span className="text-buzz-mute font-normal">
                {" · "}{matchedCount} matched
                {unmatchedCount > 0 && `, ${unmatchedCount} need a venue`}
              </span>
            </p>
            <div className="flex items-center gap-2">
              <label className="inline-flex items-center gap-2 text-xs cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={(e) =>
                    setDrafts((ds) =>
                      ds.map((d) => ({ ...d, selected: e.target.checked })),
                    )
                  }
                  className="accent-buzz-accent"
                />
                Select all
              </label>
              <button
                type="button"
                onClick={publish}
                disabled={publishing || matchedCount === 0}
                className="btn-primary"
              >
                {publishing
                  ? "Publishing…"
                  : `Add ${matchedCount} to ${festivalName}`}
              </button>
            </div>
          </div>

          <ul className="card divide-y divide-buzz-border/60">
            {drafts.map((d, i) => (
              <li key={d.draftId} className="p-4 flex flex-col sm:flex-row gap-3">
                <div className="shrink-0">
                  <input
                    type="checkbox"
                    checked={d.selected}
                    onChange={(e) => updateDraft(i, { selected: e.target.checked })}
                    className="accent-buzz-accent mt-1.5"
                  />
                </div>

                <div
                  className="w-20 h-20 sm:w-24 sm:h-24 shrink-0 rounded-lg bg-buzz-surface border border-buzz-border"
                  style={{
                    backgroundImage: `url(${d.posterImageUrl})`,
                    backgroundSize: "cover",
                    backgroundPosition: "center",
                  }}
                  aria-hidden
                />

                <div className="flex-1 min-w-0 flex flex-col gap-2">
                  <input
                    type="text"
                    value={d.title}
                    onChange={(e) => updateDraft(i, { title: e.target.value })}
                    className="input font-medium"
                    placeholder="Event title"
                  />

                  <div className="text-xs text-buzz-mute flex items-center gap-2 flex-wrap">
                    📅 {toLocalLabel(d.starts_at, d.ends_at)}
                    {!d.ends_at && (
                      <span
                        className="text-[10px] uppercase tracking-wider text-buzz-mute/70"
                        title="No end time on the poster — event ends at the venue's closing time by default"
                      >
                        no end time
                      </span>
                    )}
                    {d.confidence < 0.7 && (
                      <span
                        className="text-[10px] uppercase tracking-wider text-amber-400"
                        title="AI wasn't confident about this one"
                      >
                        low confidence
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-2 flex-wrap">
                    <label className="text-xs text-buzz-mute shrink-0">Venue:</label>
                    <select
                      value={d.matchedVenueId ?? ""}
                      onChange={async (e) => {
                        const choice = e.target.value;
                        // "Create new venue" sentinel: fire the create
                        // server action with the poster's venue_hint,
                        // then attach the resulting venue to this draft.
                        if (choice === CREATE_SENTINEL) {
                          const hint = (d.venueHint ?? "").trim();
                          if (!hint) return;
                          const res = await createVenueForFestival({
                            festivalId,
                            name: hint,
                          });
                          if ("error" in res) {
                            setError(`${hint}: ${res.error}`);
                            return;
                          }
                          // Add to the dropdown options so it's pickable
                          // for any subsequent drafts in this batch too.
                          setVenueOptions((opts) => {
                            if (opts.some((o) => o.id === res.venueId)) return opts;
                            return [
                              ...opts,
                              {
                                id: res.venueId,
                                name: res.venueName,
                                city: res.citySlug,
                              },
                            ].sort((a, b) => a.name.localeCompare(b.name));
                          });
                          // Auto-attach this draft AND every other draft
                          // whose venue_hint also points at this venue,
                          // so admin doesn't have to click Create 5 times
                          // for 5 drafts that share the same venue name.
                          const normHint = hint.toLowerCase().replace(/^the\s+/i, "").replace(/[^a-z0-9]+/g, "");
                          setDrafts((ds) =>
                            ds.map((dx) => {
                              if (dx.matchedVenueId) return dx; // already attached
                              const otherNorm = (dx.venueHint ?? "")
                                .toLowerCase()
                                .replace(/^the\s+/i, "")
                                .replace(/[^a-z0-9]+/g, "");
                              if (otherNorm === normHint) {
                                return {
                                  ...dx,
                                  matchedVenueId: res.venueId,
                                  matchedVenueName: res.venueName,
                                };
                              }
                              return dx;
                            }),
                          );
                          setInfo(`✓ Created venue "${res.venueName}" and attached every draft from this venue. Edit its city / details from the venues admin later.`);
                          return;
                        }
                        const venueId = choice || null;
                        const venue = venueOptions.find((v) => v.id === venueId);
                        updateDraft(i, {
                          matchedVenueId: venueId,
                          matchedVenueName: venue?.name ?? null,
                        });
                      }}
                      className="input flex-1 text-sm py-1"
                    >
                      <option value="">
                        {d.venueHint
                          ? `— pick a venue (poster said "${d.venueHint}") —`
                          : "— no venue on poster —"}
                      </option>
                      {d.venueHint && (
                        <option value={CREATE_SENTINEL}>
                          + Create new venue: "{d.venueHint}"
                        </option>
                      )}
                      {venueOptions.map((v) => (
                        <option key={v.id} value={v.id}>
                          {v.name}
                          {v.city ? ` · ${v.city}` : ""}
                        </option>
                      ))}
                    </select>
                  </div>

                  <textarea
                    value={d.description}
                    onChange={(e) => updateDraft(i, { description: e.target.value })}
                    className="input text-sm min-h-[60px]"
                    placeholder="Description (optional)"
                  />

                  <div className="flex justify-end">
                    <button
                      type="button"
                      onClick={() => removeDraft(i)}
                      className="text-xs text-rose-400/70 hover:text-rose-400"
                    >
                      Remove
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
