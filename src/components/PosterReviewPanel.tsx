"use client";

// Shared review UI for venue + artist poster uploads.
// 1. User picks 1-5 images.
// 2. Each is uploaded to Supabase Storage and run through AI extraction.
// 3. Drafts appear as editable cards.
// 4. User edits / removes / publishes all.

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  extractDraftsFromPoster,
  publishPosterDrafts,
  detectPosterConflicts,
  type DraftEvent,
  type PosterConflict,
  type ConflictResolution,
} from "@/lib/poster-actions";

const MAX_POSTERS = 5;

type PosterDraft = DraftEvent & {
  posterImageUrl: string;
  localKey: string;
};

type Phase = "idle" | "processing" | "reviewing" | "checking" | "resolving" | "publishing" | "done";

export default function PosterReviewPanel({
  venueId,
  venueName,
  onClose,
}: {
  venueId: string;
  venueName: string;
  onClose?: () => void;
}) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [drafts, setDrafts] = useState<PosterDraft[]>([]);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [venueOwned, setVenueOwned] = useState(true);
  const [publishedSummary, setPublishedSummary] = useState<{ count: number; pending: boolean; replaced: number; skipped: number } | null>(null);
  // Conflicts surfaced after the pre-flight check. draftIdx in PosterConflict
  // refers to the panel-wide drafts array index.
  const [conflicts, setConflicts] = useState<PosterConflict[]>([]);
  // Per-draft resolution chosen by the user. Keyed by panel-wide draftIdx.
  const [resolutions, setResolutions] = useState<Record<number, ConflictResolution>>({});

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    const list = Array.from(files).slice(0, MAX_POSTERS);
    setError(null);
    setPhase("processing");
    setProgress(`Uploading ${list.length} poster${list.length === 1 ? "" : "s"}…`);

    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      setError("You're not signed in.");
      setPhase("idle");
      return;
    }

    const newDrafts: PosterDraft[] = [];
    for (let i = 0; i < list.length; i++) {
      const file = list[i];
      setProgress(`Reading poster ${i + 1} of ${list.length}…`);

      // Upload to storage
      const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
      const path = `events/${user.id}/${Date.now()}-${i}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from("media")
        .upload(path, file, { upsert: false, contentType: file.type || "image/jpeg" });
      if (upErr) {
        setError(`Upload failed: ${upErr.message}`);
        setPhase("idle");
        return;
      }
      const { data } = supabase.storage.from("media").getPublicUrl(path);
      const posterUrl = data.publicUrl;

      // Extract via AI
      setProgress(`Reading gigs from poster ${i + 1} of ${list.length}…`);
      const result = await extractDraftsFromPoster({ venueId, imageUrl: posterUrl });
      if ("error" in result) {
        setError(result.error);
        setPhase("idle");
        return;
      }
      setVenueOwned(result.venueOwned);
      for (const d of result.drafts) {
        newDrafts.push({ ...d, posterImageUrl: posterUrl, localKey: `${posterUrl}-${newDrafts.length}` });
      }
    }

    setDrafts(newDrafts);
    setProgress(null);
    setPhase(newDrafts.length > 0 ? "reviewing" : "idle");
    if (newDrafts.length === 0) {
      setError("Couldn't find any gigs in those posters. Try a clearer image, or make sure the date and time are visible.");
    }
  }

  function updateDraft(idx: number, patch: Partial<PosterDraft>) {
    setDrafts((prev) => prev.map((d, i) => (i === idx ? { ...d, ...patch } : d)));
  }

  function removeDraft(idx: number) {
    setDrafts((prev) => prev.filter((_, i) => i !== idx));
  }

  // Step 1: pre-flight conflict check across all drafts. If anything clashes,
  // route to the resolution screen. Otherwise straight to publish.
  async function publish() {
    if (drafts.length === 0) return;
    setError(null);
    setPhase("checking");

    const detect = await detectPosterConflicts({
      venueId,
      drafts: drafts.map((d) => ({ title: d.title, starts_at: d.starts_at })),
    });
    if ("error" in detect) {
      setError(detect.error);
      setPhase("reviewing");
      return;
    }

    if (detect.conflicts.length > 0) {
      setConflicts(detect.conflicts);
      // Default each conflict to "skip" so the safest choice is pre-selected
      // — user must actively choose Replace or Keep both to overwrite/duplicate.
      const seed: Record<number, ConflictResolution> = {};
      for (const c of detect.conflicts) seed[c.draftIdx] = "skip";
      setResolutions(seed);
      setPhase("resolving");
      return;
    }

    await doPublish({});
  }

  // Step 2 (called from publish() or from the resolution screen).
  async function doPublish(globalResolutions: Record<number, ConflictResolution>) {
    setPhase("publishing");
    setError(null);

    // Group drafts by poster image. Each group is one publish call (one
    // poster persisted to storage, shared across that group's events).
    const byPoster = new Map<string, { draft: PosterDraft; panelIdx: number }[]>();
    drafts.forEach((d, i) => {
      const list = byPoster.get(d.posterImageUrl) ?? [];
      list.push({ draft: d, panelIdx: i });
      byPoster.set(d.posterImageUrl, list);
    });

    let totalPublished = 0;
    let totalReplaced = 0;
    let totalSkipped = 0;
    let anyPending = false;
    for (const [posterImageUrl, group] of byPoster.entries()) {
      // Translate panel-wide resolutions into per-group draftIdx.
      const groupResolutions: Record<number, ConflictResolution> = {};
      group.forEach(({ panelIdx }, groupIdx) => {
        const r = globalResolutions[panelIdx];
        if (r) groupResolutions[groupIdx] = r;
      });

      const r = await publishPosterDrafts({
        venueId,
        posterImageUrl,
        drafts: group.map(({ draft: d }) => ({
          title: d.title,
          starts_at: d.starts_at,
          ends_at: d.ends_at,
          description: d.description,
          genres: d.genres,
          artists: d.artists,
          confidence: d.confidence,
        })),
        resolutions: groupResolutions,
      });
      if ("error" in r) {
        setError(r.error);
        setPhase(conflicts.length > 0 ? "resolving" : "reviewing");
        return;
      }
      // Defensive: if conflicts come back here something raced — surface them.
      if ("conflicts" in r) {
        setError("Conflicts changed since the check. Please try again.");
        setPhase("reviewing");
        return;
      }
      totalPublished += r.published;
      totalReplaced += r.replaced ?? 0;
      totalSkipped += r.skipped ?? 0;
      if (r.pending) anyPending = true;
    }

    setPublishedSummary({
      count: totalPublished,
      pending: anyPending,
      replaced: totalReplaced,
      skipped: totalSkipped,
    });
    setPhase("done");
  }

  function setResolution(draftIdx: number, r: ConflictResolution) {
    setResolutions((prev) => ({ ...prev, [draftIdx]: r }));
  }

  if (phase === "done" && publishedSummary) {
    const { count, pending, replaced, skipped } = publishedSummary;
    return (
      <div className="card p-8 text-center">
        <div className="text-5xl mb-3">{pending ? "📨" : "✅"}</div>
        <h3 className="h-display text-2xl mb-2">
          {count} gig{count === 1 ? "" : "s"}{" "}
          {pending ? "submitted for review" : "published"}
        </h3>
        {(replaced > 0 || skipped > 0) && (
          <p className="text-xs text-buzz-mute mb-2">
            {replaced > 0 && <>Replaced {replaced} existing gig{replaced === 1 ? "" : "s"}. </>}
            {skipped > 0 && <>Kept {skipped} existing gig{skipped === 1 ? "" : "s"} as-is.</>}
          </p>
        )}
        <p className="text-buzz-mute mb-4 max-w-md mx-auto">
          {pending
            ? `${venueName} hasn't been claimed yet, so an admin will review and approve your gig${count === 1 ? "" : "s"} shortly. We'll be in touch if anything's off.`
            : count > 0
              ? `Your gig${count === 1 ? " is" : "s are"} live on The Buzz Guide now.`
              : `Nothing new published — all your drafts were duplicates.`}
        </p>
        {onClose && (
          <button type="button" onClick={onClose} className="btn-secondary">
            Close
          </button>
        )}
      </div>
    );
  }

  // Resolution screen — surfaced when the pre-flight check found same-venue,
  // same-hour collisions. User picks per-conflict: keep existing, replace, or
  // keep both.
  if (phase === "resolving" || (phase === "publishing" && conflicts.length > 0)) {
    const conflictingIdx = new Set(conflicts.map((c) => c.draftIdx));
    const cleanCount = drafts.length - conflictingIdx.size;
    return (
      <div className="flex flex-col gap-4">
        <div className="card p-4 flex flex-col gap-2">
          <p className="eyebrow text-buzz-accent">Already booked</p>
          <h3 className="h-display text-xl">
            {conflicts.length} of your {drafts.length} gig{drafts.length === 1 ? "" : "s"} clash with existing events at {venueName}
          </h3>
          <p className="text-buzz-mute text-sm">
            Pick what to do for each. The {cleanCount} non-clashing draft{cleanCount === 1 ? "" : "s"} will publish as normal.
          </p>
        </div>

        {error && <div className="card p-3 text-sm text-rose-400">{error}</div>}

        <div className="flex flex-col gap-3">
          {conflicts.map((c) => {
            const newDraft = drafts[c.draftIdx];
            if (!newDraft) return null;
            const choice = resolutions[c.draftIdx] ?? "skip";
            return (
              <div key={c.draftIdx} className="card p-4 flex flex-col gap-3">
                <div className="grid sm:grid-cols-2 gap-3">
                  <div className="border border-buzz-border rounded-lg p-3 bg-buzz-surface/30">
                    <div className="eyebrow text-[10px] mb-2">Already on The Buzz Guide</div>
                    <div className="flex gap-3 items-start">
                      {c.existing.image_url ? (
                        <div
                          className="w-16 h-20 rounded bg-buzz-surface shrink-0 border border-buzz-border"
                          style={{
                            backgroundImage: `url(${c.existing.image_url})`,
                            backgroundSize: "cover",
                            backgroundPosition: "center",
                          }}
                        />
                      ) : (
                        <div className="w-16 h-20 rounded bg-buzz-surface shrink-0 border border-buzz-border grid place-items-center text-2xl">
                          🎵
                        </div>
                      )}
                      <div className="min-w-0">
                        <div className="font-medium truncate">{c.existing.title}</div>
                        <div className="text-xs text-buzz-mute mt-1">
                          {formatWhen(c.existing.start_time)}
                        </div>
                        {c.existing.auto_imported_from && (
                          <div className="text-[10px] text-buzz-mute mt-1">
                            Source: {c.existing.auto_imported_from}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="border border-buzz-accent/40 rounded-lg p-3 bg-buzz-accent/5">
                    <div className="eyebrow text-[10px] mb-2 text-buzz-accent">Your new draft</div>
                    <div className="flex gap-3 items-start">
                      <div
                        className="w-16 h-20 rounded bg-buzz-surface shrink-0 border border-buzz-border"
                        style={{
                          backgroundImage: `url(${newDraft.posterImageUrl})`,
                          backgroundSize: "cover",
                          backgroundPosition: "center",
                        }}
                      />
                      <div className="min-w-0">
                        <div className="font-medium truncate">{newDraft.title}</div>
                        <div className="text-xs text-buzz-mute mt-1">
                          {formatWhen(newDraft.starts_at)}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="flex flex-wrap gap-2">
                  <ResolutionChip
                    label="Keep existing"
                    hint="Drop my new draft"
                    active={choice === "skip"}
                    onClick={() => setResolution(c.draftIdx, "skip")}
                  />
                  <ResolutionChip
                    label="Replace it"
                    hint="Delete the old one, use my new draft"
                    active={choice === "replace"}
                    onClick={() => setResolution(c.draftIdx, "replace")}
                  />
                  <ResolutionChip
                    label="Keep both"
                    hint="Different events at the same time"
                    active={choice === "keep_both"}
                    onClick={() => setResolution(c.draftIdx, "keep_both")}
                  />
                </div>
              </div>
            );
          })}
        </div>

        <div className="flex gap-2 justify-end">
          <button
            type="button"
            onClick={() => {
              setConflicts([]);
              setResolutions({});
              setPhase("reviewing");
            }}
            disabled={phase === "publishing"}
            className="btn-secondary"
          >
            Back
          </button>
          <button
            type="button"
            onClick={() => doPublish(resolutions)}
            disabled={phase === "publishing"}
            className="btn-primary"
          >
            {phase === "publishing" ? "Publishing…" : "Confirm and publish"}
          </button>
        </div>
      </div>
    );
  }

  if (phase === "idle" || phase === "processing") {
    return (
      <div className="card p-6">
        <h3 className="h-display text-2xl mb-2">📸 Upload poster(s)</h3>
        <p className="text-buzz-mute text-sm mb-5 max-w-xl">
          Pick up to {MAX_POSTERS} gig posters at once. We'll read the title, date/time and lineup
          off each one, then you can review and tweak before publishing.
        </p>

        <input
          type="file"
          accept="image/*"
          multiple
          disabled={phase === "processing"}
          onChange={(e) => handleFiles(e.target.files)}
          className="block text-sm text-buzz-mute file:mr-3 file:py-2 file:px-3 file:rounded-md file:border-0 file:bg-buzz-surface file:text-buzz-text hover:file:bg-buzz-card cursor-pointer"
        />
        {progress && <div className="text-xs text-buzz-accent mt-3">{progress}</div>}
        {error && <div className="text-sm text-rose-400 mt-3">{error}</div>}
      </div>
    );
  }

  // reviewing or publishing
  return (
    <div className="flex flex-col gap-4">
      <div className="card p-4 flex items-start justify-between gap-3 flex-wrap">
        <div>
          <p className="eyebrow mb-1">Review</p>
          <h3 className="h-display text-xl">
            {drafts.length} gig{drafts.length === 1 ? "" : "s"} found
          </h3>
          {!venueOwned && (
            <p className="text-xs text-buzz-accent mt-2">
              ⓘ {venueName} hasn't been claimed yet, so your submission will go to admin
              review before it's published.
            </p>
          )}
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={publish}
            disabled={phase === "publishing" || phase === "checking" || drafts.length === 0}
            className="btn-primary"
          >
            {phase === "checking"
              ? "Checking for clashes…"
              : phase === "publishing"
                ? "Publishing…"
                : venueOwned
                  ? `Publish ${drafts.length} gig${drafts.length === 1 ? "" : "s"}`
                  : `Submit for review`}
          </button>
        </div>
      </div>

      {error && <div className="card p-3 text-sm text-rose-400">{error}</div>}

      <div className="grid gap-4 sm:grid-cols-2">
        {drafts.map((d, i) => (
          <DraftCard
            key={d.localKey}
            draft={d}
            onChange={(patch) => updateDraft(i, patch)}
            onRemove={() => removeDraft(i)}
          />
        ))}
      </div>
    </div>
  );
}

function DraftCard({
  draft,
  onChange,
  onRemove,
}: {
  draft: PosterDraft;
  onChange: (patch: Partial<PosterDraft>) => void;
  onRemove: () => void;
}) {
  const dtLocal = toDatetimeLocal(draft.starts_at);
  return (
    <div className="card p-4 flex flex-col gap-3">
      <div className="flex gap-3 items-start">
        <div
          className="w-24 h-32 rounded-lg bg-buzz-surface shrink-0 border border-buzz-border"
          style={{
            backgroundImage: `url(${draft.posterImageUrl})`,
            backgroundSize: "cover",
            backgroundPosition: "center",
          }}
        />
        <div className="flex-1 min-w-0">
          <label className="label">Title</label>
          <input
            className="input"
            value={draft.title}
            onChange={(e) => onChange({ title: e.target.value })}
            maxLength={200}
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="label">Starts</label>
          <input
            type="datetime-local"
            className="input"
            value={dtLocal}
            onChange={(e) => onChange({ starts_at: fromDatetimeLocal(e.target.value) })}
            style={{ colorScheme: "dark" }}
          />
        </div>
        <div>
          <label className="label">Ends (optional)</label>
          <input
            type="datetime-local"
            className="input"
            value={draft.ends_at ? toDatetimeLocal(draft.ends_at) : ""}
            onChange={(e) => onChange({ ends_at: e.target.value ? fromDatetimeLocal(e.target.value) : null })}
            style={{ colorScheme: "dark" }}
          />
        </div>
      </div>

      <div>
        <label className="label">Description</label>
        <textarea
          className="input min-h-[60px]"
          value={draft.description}
          onChange={(e) => onChange({ description: e.target.value })}
          maxLength={2000}
        />
      </div>

      {draft.artists.length > 0 && (
        <div>
          <label className="label">Lineup</label>
          <input
            className="input"
            value={draft.artists.join(", ")}
            onChange={(e) =>
              onChange({
                artists: e.target.value
                  .split(",")
                  .map((s) => s.trim())
                  .filter((s) => s.length > 0),
              })
            }
            placeholder="Artist names, comma separated"
          />
        </div>
      )}

      <div className="flex items-center justify-between">
        <span className="text-xs text-buzz-mute">
          AI confidence: {(draft.confidence * 100).toFixed(0)}%
        </span>
        <button type="button" onClick={onRemove} className="text-xs text-rose-400 hover:text-rose-300">
          Remove
        </button>
      </div>
    </div>
  );
}

function ResolutionChip({
  label,
  hint,
  active,
  onClick,
}: {
  label: string;
  hint: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-3 py-2 rounded-lg text-left border transition ${
        active
          ? "border-buzz-accent bg-buzz-accent/10 text-buzz-text"
          : "border-buzz-border bg-buzz-surface text-buzz-mute hover:border-buzz-accent/50 hover:text-buzz-text"
      }`}
    >
      <div className="text-sm font-medium">{label}</div>
      <div className="text-[11px] text-buzz-mute">{hint}</div>
    </button>
  );
}

function formatWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// ISO datetime <-> <input type="datetime-local"> value conversion
function toDatetimeLocal(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fromDatetimeLocal(value: string): string {
  if (!value) return "";
  return new Date(value).toISOString();
}
