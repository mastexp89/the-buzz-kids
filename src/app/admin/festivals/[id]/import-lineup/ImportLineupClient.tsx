"use client";

// Three-phase admin UI:
//   1. Upload one or more poster images (drag/drop → Supabase Storage).
//   2. Click "Extract lineup" → server calls Claude vision, returns
//      preview rows with venue / artist / day / time fields editable.
//   3. Review the table, untick anything wrong, click "Publish" → server
//      creates an event row per ticked slot at the chosen venue.
//
// Designed for the volume of a city-wide multi-venue festival
// (Dundee Music Festival has 80+ slots across 20 venues, etc.) where
// manual entry via Quick Import / Paste Fixtures would take an hour
// per festival.

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  extractFestivalLineupAction,
  publishFestivalLineupAction,
  type LineupPreviewRow,
  type FestivalLineupVenueOption,
  type PublishDraft,
} from "./actions";

const MAX_POSTERS = 5;

type UploadedImage = {
  url: string;
  fileName: string;
};

// Local editable copy of each preview row — the user adjusts venue,
// day, time before publishing.
//
// Venue resolution per row is one of three states:
//   1. venueId !== null && !willCreate
//        Use an existing Buzz venue. Standard case.
//   2. willCreate === true && venueId === null
//        Create a brand-new venue with `createVenueName` (initially
//        seeded from Claude's extraction) under `cityId`. Publish will
//        do the insert + auto-link.
//   3. venueId === null && !willCreate
//        Invalid — admin hasn't picked. Row gets unticked.
type EditableRow = {
  // Stable id for React keys + ticking. Built from idx since the data
  // has no natural id at preview stage.
  rowKey: string;
  venueId: string | null;
  // Set when this row will create a new venue on publish.
  willCreate: boolean;
  createVenueName: string;
  cityId: string | null;
  artistName: string;
  day: string;
  startTime: string;
  endTime: string;
  stage: string;
  selected: boolean;
  // Echo of Claude's original venue text so the admin can see what
  // was extracted vs what they've overridden.
  rawVenue: string;
  artistExists: boolean;
};

export default function ImportLineupClient({
  festivalId,
  festivalSlug,
  festivalName,
  venues: initialVenues,
}: {
  festivalId: string;
  festivalSlug: string;
  festivalName: string;
  venues: FestivalLineupVenueOption[];
}) {
  const router = useRouter();
  const [images, setImages] = useState<UploadedImage[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const [previewRows, setPreviewRows] = useState<EditableRow[] | null>(null);
  const [venueOptions, setVenueOptions] = useState<FestivalLineupVenueOption[]>(initialVenues);
  const [defaultCity, setDefaultCity] = useState<{ id: string; name: string } | null>(null);
  const [days, setDays] = useState<string[]>([]);
  const [extractError, setExtractError] = useState<string | null>(null);
  const [extracting, startExtracting] = useTransition();

  const [publishResult, setPublishResult] = useState<{
    created: number;
    skipped: number;
    venuesCreated: number;
    venuesLinked: number;
    errors: string[];
  } | null>(null);
  const [publishError, setPublishError] = useState<string | null>(null);
  const [publishing, startPublishing] = useTransition();

  // Note: the importer used to block here when the festival had no
  // linked venues. That was the right call when we ONLY matched against
  // already-linked venues — there was nowhere for events to land. Now
  // we match against every approved Buzz venue and create new ones on
  // the fly, so this gate is no longer needed. Festival-with-no-venues
  // becomes "all venues will be auto-created on publish", which is
  // exactly what an admin importing a brand-new festival wants.

  async function handleFiles(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return;
    const files = Array.from(fileList).slice(0, MAX_POSTERS - images.length);
    setUploadError(null);
    setUploading(true);
    try {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setUploadError("Not signed in.");
        return;
      }
      const newImages: UploadedImage[] = [];
      for (const file of files) {
        if (!file.type.startsWith("image/")) {
          setUploadError(`${file.name} isn't an image — skipped.`);
          continue;
        }
        if (file.size > 10 * 1024 * 1024) {
          setUploadError(`${file.name} is over 10 MB — skipped.`);
          continue;
        }
        const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
        const path = `festivals/${festivalId}/lineup-${Date.now()}-${newImages.length}.${ext}`;
        const { error: upErr } = await supabase.storage
          .from("media")
          .upload(path, file, {
            upsert: true,
            contentType: file.type || "image/jpeg",
          });
        if (upErr) {
          setUploadError(`Upload failed for ${file.name}: ${upErr.message}`);
          continue;
        }
        const { data } = supabase.storage.from("media").getPublicUrl(path);
        newImages.push({ url: data.publicUrl, fileName: file.name });
      }
      setImages((prev) => [...prev, ...newImages]);
    } finally {
      setUploading(false);
    }
  }

  function removeImage(url: string) {
    setImages((prev) => prev.filter((img) => img.url !== url));
  }

  function runExtraction() {
    if (images.length === 0) return;
    setExtractError(null);
    setPreviewRows(null);
    setPublishResult(null);
    startExtracting(async () => {
      const r = await extractFestivalLineupAction({
        festivalId,
        imageUrls: images.map((i) => i.url),
      });
      if ("error" in r) {
        setExtractError(r.error);
        return;
      }
      setVenueOptions(r.venueOptions);
      setDefaultCity(r.defaultCity);
      setDays(r.days);
      setPreviewRows(
        r.rows.map((row, idx) => previewRowToEditable(row, idx, r.defaultCity?.id ?? null)),
      );
    });
  }

  function publishSelected() {
    if (!previewRows) return;
    const drafts: PublishDraft[] = previewRows
      .filter(isRowReady)
      .map((r) => ({
        venueId: r.willCreate ? null : r.venueId,
        createVenueName: r.willCreate ? r.createVenueName : null,
        cityId: r.willCreate ? r.cityId : null,
        artistName: r.artistName,
        day: r.day,
        startTime: r.startTime,
        endTime: r.endTime || null,
        stage: r.stage || null,
      }));
    if (drafts.length === 0) {
      setPublishError("Tick at least one row that's ready to publish.");
      return;
    }
    setPublishError(null);
    setPublishResult(null);
    startPublishing(async () => {
      const r = await publishFestivalLineupAction({ festivalId, drafts });
      if ("error" in r) {
        setPublishError(r.error);
        return;
      }
      setPublishResult({
        created: r.created,
        skipped: r.skipped,
        venuesCreated: r.venuesCreated,
        venuesLinked: r.venuesLinked,
        errors: r.errors,
      });
      // Refresh the admin page so the linked schedule reflects the
      // newly-created events when the admin navigates back.
      router.refresh();
    });
  }

  // A row is "ready to publish" when ticked AND either has a valid
  // existing venue picked OR has the create-new path filled in.
  function isRowReady(r: EditableRow): boolean {
    if (!r.selected) return false;
    if (r.willCreate) return r.createVenueName.trim().length > 0 && !!r.cityId;
    return !!r.venueId;
  }

  const selectedReadyCount = previewRows?.filter(isRowReady).length ?? 0;
  const createNewCount = previewRows?.filter((r) => r.selected && r.willCreate).length ?? 0;
  const needsAttentionCount = previewRows?.filter(
    (r) => r.selected && !isRowReady(r),
  ).length ?? 0;

  return (
    <div className="flex flex-col gap-6">
      {/* Step 1: upload posters */}
      <section className="card p-5">
        <h2 className="font-medium mb-2">Step 1 · Upload poster image(s)</h2>
        <p className="text-xs text-buzz-mute mb-4">
          Up to {MAX_POSTERS} images. Pictures of the full programme work
          best. If the lineup spans multiple posters / pages, upload them
          all together — Claude reads them as one.
        </p>

        {images.length > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3 mb-4">
            {images.map((img) => (
              <div
                key={img.url}
                className="relative aspect-square rounded-md overflow-hidden border border-buzz-border bg-buzz-surface"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={img.url}
                  alt={img.fileName}
                  className="w-full h-full object-cover"
                />
                <button
                  type="button"
                  onClick={() => removeImage(img.url)}
                  className="absolute top-1 right-1 bg-buzz-bg/80 text-buzz-text text-xs px-2 py-1 rounded hover:bg-rose-500/80 transition"
                  aria-label={`Remove ${img.fileName}`}
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}

        <label className="btn-secondary text-sm cursor-pointer inline-block">
          <input
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => handleFiles(e.target.files)}
            disabled={uploading || images.length >= MAX_POSTERS}
          />
          {uploading
            ? "Uploading…"
            : images.length === 0
              ? "Choose poster image(s)"
              : images.length >= MAX_POSTERS
                ? `${MAX_POSTERS} images uploaded (max)`
                : "+ Add another"}
        </label>
        {uploadError && (
          <p className="text-xs text-rose-400 mt-2">{uploadError}</p>
        )}
      </section>

      {/* Step 2: extract */}
      {images.length > 0 && (
        <section className="card p-5 border-buzz-accent/30">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div>
              <h2 className="font-medium">Step 2 · Run AI extraction</h2>
              <p className="text-xs text-buzz-mute mt-1">
                Claude reads the {images.length} image{images.length === 1 ? "" : "s"} and
                returns a row per act. Takes 20-60s for a busy programme.
              </p>
            </div>
            <button
              type="button"
              onClick={runExtraction}
              disabled={extracting}
              className="btn-primary text-sm"
            >
              {extracting ? "Extracting…" : "Extract lineup →"}
            </button>
          </div>
          {extractError && (
            <p className="text-xs text-rose-400 mt-3">{extractError}</p>
          )}
        </section>
      )}

      {/* Step 3: review */}
      {previewRows && previewRows.length > 0 && (
        <section className="card p-5">
          <div className="flex items-center justify-between mb-3 gap-3 flex-wrap">
            <div>
              <h2 className="font-medium">
                Step 3 · Review &amp; publish ({previewRows.length} slots found)
              </h2>
              <div className="text-xs text-buzz-mute mt-1 flex flex-wrap gap-x-3 gap-y-1">
                {createNewCount > 0 && (
                  <span>
                    🆕 {createNewCount} will create new venue
                    {defaultCity ? ` in ${defaultCity.name}` : ""}
                  </span>
                )}
                {needsAttentionCount > 0 && (
                  <span className="text-amber-400">
                    ⚠ {needsAttentionCount} need
                    {needsAttentionCount === 1 ? "s" : ""} a venue picked
                  </span>
                )}
              </div>
              <p className="text-xs text-buzz-mute mt-2">
                💡 Empty <strong>end</strong> times will be auto-set to the
                next act&apos;s start time at that venue. The final act of
                each day runs to the venue&apos;s closing time (or +90 mins
                if no closing time is set).
              </p>
            </div>
            <button
              type="button"
              onClick={publishSelected}
              disabled={publishing || selectedReadyCount === 0}
              className="btn-primary text-sm"
            >
              {publishing
                ? "Publishing…"
                : `Publish ${selectedReadyCount} act${selectedReadyCount === 1 ? "" : "s"}`}
            </button>
          </div>

          {publishResult && (
            <div className="card p-4 mb-4 border-emerald-500/40 bg-emerald-500/5">
              <p className="text-sm font-medium">
                ✅ Created {publishResult.created} event{publishResult.created === 1 ? "" : "s"}
                {publishResult.venuesCreated > 0 && ` · ${publishResult.venuesCreated} new venue${publishResult.venuesCreated === 1 ? "" : "s"}`}
                {publishResult.venuesLinked > 0 && ` · ${publishResult.venuesLinked} venue${publishResult.venuesLinked === 1 ? "" : "s"} linked`}
                {publishResult.skipped > 0 && ` · skipped ${publishResult.skipped}`}
              </p>
              {publishResult.errors.length > 0 && (
                <details className="mt-2 text-xs text-buzz-mute">
                  <summary className="cursor-pointer">Errors ({publishResult.errors.length})</summary>
                  <ul className="mt-2 list-disc pl-5">
                    {publishResult.errors.map((err, i) => (
                      <li key={i}>{err}</li>
                    ))}
                  </ul>
                </details>
              )}
              <div className="mt-3 flex gap-2">
                <Link
                  href={`/festivals/${festivalSlug}`}
                  target="_blank"
                  className="btn-secondary text-xs"
                >
                  View festival page ↗
                </Link>
                <Link
                  href={`/admin/festivals/${festivalId}`}
                  className="btn-secondary text-xs"
                >
                  Back to festival admin
                </Link>
              </div>
            </div>
          )}
          {publishError && (
            <p className="text-xs text-rose-400 mb-3">{publishError}</p>
          )}

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-buzz-mute uppercase tracking-wider">
                <tr>
                  <th className="text-left pb-2 w-8">
                    <input
                      type="checkbox"
                      checked={previewRows.every((r) => r.selected)}
                      onChange={(e) => {
                        const all = e.target.checked;
                        setPreviewRows((prev) =>
                          prev!.map((r) => ({ ...r, selected: all })),
                        );
                      }}
                    />
                  </th>
                  <th className="text-left pb-2">Artist</th>
                  <th className="text-left pb-2">Venue</th>
                  <th className="text-left pb-2">Day</th>
                  <th className="text-left pb-2">Start</th>
                  <th className="text-left pb-2">End</th>
                  <th className="text-left pb-2">Stage (opt)</th>
                </tr>
              </thead>
              <tbody>
                {previewRows.map((row, idx) => (
                  <tr
                    key={row.rowKey}
                    className={
                      "border-t border-buzz-border/60 " +
                      (!row.venueId ? "bg-amber-500/5" : "")
                    }
                  >
                    <td className="py-2">
                      <input
                        type="checkbox"
                        checked={row.selected}
                        onChange={(e) => updateRow(idx, { selected: e.target.checked })}
                      />
                    </td>
                    <td className="py-2 pr-2">
                      <input
                        type="text"
                        value={row.artistName}
                        onChange={(e) => updateRow(idx, { artistName: e.target.value })}
                        className="input text-sm"
                      />
                      {!row.artistExists && (
                        <span className="text-[10px] text-buzz-accent">+ new artist</span>
                      )}
                    </td>
                    <td className="py-2 pr-2 min-w-[220px]">
                      {/* Three-state venue cell. The dropdown lists
                          every Buzz venue + a special "+ Create new"
                          option that, when picked, turns the cell into
                          an editable text input pre-seeded with what
                          Claude extracted. */}
                      <select
                        value={
                          row.willCreate
                            ? "__create__"
                            : (row.venueId ?? "")
                        }
                        onChange={(e) => {
                          const v = e.target.value;
                          if (v === "__create__") {
                            updateRow(idx, {
                              willCreate: true,
                              venueId: null,
                              // Seed with the raw extracted name if not
                              // already filled.
                              createVenueName: row.createVenueName || row.rawVenue,
                            });
                          } else {
                            updateRow(idx, {
                              willCreate: false,
                              venueId: v || null,
                            });
                          }
                        }}
                        className="input text-sm"
                      >
                        <option value="">— pick venue —</option>
                        <option value="__create__">
                          {row.willCreate ? "✓ " : "+ "}
                          Create new venue
                        </option>
                        <option disabled>──────────</option>
                        {venueOptions.map((v) => (
                          <option key={v.id} value={v.id}>
                            {v.name}{v.city ? ` (${v.city})` : ""}
                          </option>
                        ))}
                      </select>
                      {row.willCreate && (
                        <input
                          type="text"
                          value={row.createVenueName}
                          onChange={(e) =>
                            updateRow(idx, { createVenueName: e.target.value })
                          }
                          placeholder="New venue name"
                          className="input text-sm mt-1"
                        />
                      )}
                      {!row.willCreate && row.venueId && row.rawVenue &&
                        // Show AI source only if admin moved away from
                        // it (the extracted text doesn't match the
                        // picked venue's name).
                        venueOptions.find((v) => v.id === row.venueId)?.name?.toLowerCase()
                        !== row.rawVenue.toLowerCase() && (
                          <span className="text-[10px] text-buzz-mute block mt-0.5">
                            AI said: {row.rawVenue}
                          </span>
                        )}
                    </td>
                    <td className="py-2 pr-2">
                      <select
                        value={row.day}
                        onChange={(e) => updateRow(idx, { day: e.target.value })}
                        className="input text-sm"
                      >
                        {days.map((d) => (
                          <option key={d} value={d}>{d}</option>
                        ))}
                      </select>
                    </td>
                    <td className="py-2 pr-2">
                      <input
                        type="time"
                        value={row.startTime}
                        onChange={(e) => updateRow(idx, { startTime: e.target.value })}
                        className="input text-sm w-24"
                      />
                    </td>
                    <td className="py-2 pr-2">
                      <input
                        type="time"
                        value={row.endTime}
                        onChange={(e) => updateRow(idx, { endTime: e.target.value })}
                        className="input text-sm w-24"
                      />
                    </td>
                    <td className="py-2 pr-2">
                      <input
                        type="text"
                        value={row.stage}
                        onChange={(e) => updateRow(idx, { stage: e.target.value })}
                        placeholder="—"
                        className="input text-sm w-32"
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );

  function updateRow(idx: number, patch: Partial<EditableRow>) {
    setPreviewRows((prev) => {
      if (!prev) return prev;
      const next = [...prev];
      next[idx] = { ...next[idx], ...patch };
      return next;
    });
  }
}

function previewRowToEditable(
  row: LineupPreviewRow,
  idx: number,
  defaultCityId: string | null,
): EditableRow {
  return {
    rowKey: `r${idx}-${row.raw.artist}-${row.raw.day}-${row.raw.startTime}`,
    venueId: row.matchedVenueId,
    willCreate: row.willCreateVenue,
    createVenueName: row.willCreateVenue ? row.raw.venue : "",
    cityId: defaultCityId,
    artistName: row.raw.artist,
    day: row.raw.day,
    startTime: row.raw.startTime,
    endTime: row.raw.endTime ?? "",
    stage: row.raw.stage ?? "",
    // Default to ticked when EITHER an existing venue matched OR we'll
    // create a new one — admin can untick anything that doesn't look
    // right after a quick scan.
    selected: !!row.matchedVenueId || row.willCreateVenue,
    rawVenue: row.raw.venue,
    artistExists: row.artistExists,
  };
}
