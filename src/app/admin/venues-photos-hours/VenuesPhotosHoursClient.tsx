"use client";

// Three-phase admin tool:
//   1. Pick a city → load venues missing photos / hours
//   2. Click "Scan next 5" → calls Apify, returns results
//   3. Per-venue preview card: tick which photos to keep, then save
//
// Step 2 runs in batches of 5 so a city with 30 venues takes ~5-6
// rounds of clicking — but each round is a single short action call,
// avoiding any Vercel timeout issues regardless of city size.

import { useState, useTransition } from "react";
import {
  listVenuesNeedingPhotosHours,
  scanVenueBatch,
  saveScannedVenueData,
  type VenueNeedingScan,
  type ScanResult,
  type OpeningHoursJson,
} from "./actions";

const BATCH_SIZE = 10;
const MAX_PHOTOS = 6;

// Tracks state for one venue currently being previewed by the admin.
type PreviewState = ScanResult & {
  venueName: string;
  // Which photo indices the admin has ticked to keep. Defaults to "all
  // up to MAX_PHOTOS" so the common case is one-click save.
  selectedPhotoIdxs: Set<number>;
  // Whether to write the parsed hours JSON. Default true if we parsed
  // anything; false otherwise (just show admin the raw text for manual
  // copy-paste if needed).
  saveHours: boolean;
  // Tracks "saving / saved / error" for this row's save button.
  savingState: "idle" | "saving" | "saved" | "error";
  saveError?: string;
};

type City = { slug: string; name: string; active: boolean };

export default function VenuesPhotosHoursClient({ cities }: { cities: City[] }) {
  const [citySlug, setCitySlug] = useState<string>("");
  const [allVenues, setAllVenues] = useState<VenueNeedingScan[]>([]);
  const [scanned, setScanned] = useState<PreviewState[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);
  const [loadingList, startLoadingList] = useTransition();
  const [scanning, startScanning] = useTransition();

  // Index into allVenues marking which venues have been scanned (or
  // skipped). Next scan picks up from here.
  const [scanCursor, setScanCursor] = useState(0);

  const remaining = Math.max(0, allVenues.length - scanCursor);

  function loadList() {
    setLoadError(null);
    setAllVenues([]);
    setScanned([]);
    setScanCursor(0);
    startLoadingList(async () => {
      const r = await listVenuesNeedingPhotosHours({
        citySlug: citySlug || null,
      });
      if ("error" in r) {
        setLoadError(r.error);
        return;
      }
      setAllVenues(r.venues);
    });
  }

  function scanNextBatch() {
    setScanError(null);
    const batch = allVenues.slice(scanCursor, scanCursor + BATCH_SIZE);
    if (batch.length === 0) return;
    startScanning(async () => {
      const r = await scanVenueBatch(batch);
      if ("error" in r) {
        setScanError(r.error);
        return;
      }
      const previewRows: PreviewState[] = r.results.map((res) => {
        const venue = batch.find((v) => v.id === res.venueId);
        const defaultIdxs = new Set<number>(
          res.photos.slice(0, MAX_PHOTOS).map((_, i) => i),
        );
        return {
          ...res,
          venueName: venue?.name ?? "(unknown venue)",
          selectedPhotoIdxs: defaultIdxs,
          saveHours: res.openingHoursJson != null,
          savingState: "idle",
        };
      });
      setScanned((prev) => [...prev, ...previewRows]);
      setScanCursor((c) => c + batch.length);
    });
  }

  function togglePhoto(venueId: string, idx: number) {
    setScanned((prev) =>
      prev.map((row) => {
        if (row.venueId !== venueId) return row;
        const next = new Set(row.selectedPhotoIdxs);
        if (next.has(idx)) next.delete(idx);
        else if (next.size < MAX_PHOTOS) next.add(idx);
        return { ...row, selectedPhotoIdxs: next };
      }),
    );
  }

  function toggleSaveHours(venueId: string) {
    setScanned((prev) =>
      prev.map((row) =>
        row.venueId === venueId ? { ...row, saveHours: !row.saveHours } : row,
      ),
    );
  }

  function saveOne(row: PreviewState) {
    setScanned((prev) =>
      prev.map((r) =>
        r.venueId === row.venueId
          ? { ...r, savingState: "saving", saveError: undefined }
          : r,
      ),
    );

    const photos = row.photos.filter((_, i) => row.selectedPhotoIdxs.has(i));
    const hoursJson: OpeningHoursJson | null = row.saveHours ? row.openingHoursJson : null;
    const hoursText: string | null = row.saveHours ? row.openingHoursText : null;

    saveScannedVenueData({
      venueId: row.venueId,
      photos,
      openingHoursJson: hoursJson,
      openingHoursText: hoursText,
    }).then((r) => {
      setScanned((prev) =>
        prev.map((x) => {
          if (x.venueId !== row.venueId) return x;
          if ("error" in r) {
            return { ...x, savingState: "error", saveError: r.error };
          }
          return { ...x, savingState: "saved" };
        }),
      );
    });
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Step 1: city picker + load button */}
      <div className="card p-4">
        <label className="block text-sm font-medium mb-2">City</label>
        <div className="flex flex-wrap gap-2 items-center">
          <select
            value={citySlug}
            onChange={(e) => setCitySlug(e.target.value)}
            className="input text-sm flex-1 min-w-[200px]"
          >
            <option value="">— All cities —</option>
            {cities.map((c) => (
              <option key={c.slug} value={c.slug}>
                {c.name} {c.active ? "" : "(hidden)"}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={loadList}
            disabled={loadingList}
            className="btn-primary text-sm"
          >
            {loadingList ? "Loading…" : "Load venues missing data"}
          </button>
        </div>
        {loadError && <p className="text-xs text-rose-400 mt-2">{loadError}</p>}
        {allVenues.length > 0 && (
          <p className="text-xs text-buzz-mute mt-3">
            <strong>{allVenues.length}</strong> venues are missing photos and/or
            opening hours. Scanned <strong>{scanCursor}</strong>,{" "}
            <strong>{remaining}</strong> to go.
          </p>
        )}
      </div>

      {/* Step 2: scan next batch */}
      {allVenues.length > 0 && remaining > 0 && (
        <div className="card p-4 border-buzz-accent/30">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="font-medium text-sm">
                Next batch: {Math.min(BATCH_SIZE, remaining)} venues
              </h3>
              <p className="text-xs text-buzz-mute mt-1">
                Each scan runs an Apify Google Places lookup per venue (~10-30s
                each, run in parallel). Cost ≈ $0.002 / venue.
              </p>
            </div>
            <button
              type="button"
              onClick={scanNextBatch}
              disabled={scanning}
              className="btn-primary text-sm"
            >
              {scanning ? "Scanning…" : `Scan next ${Math.min(BATCH_SIZE, remaining)} →`}
            </button>
          </div>
          {scanError && <p className="text-xs text-rose-400 mt-2">{scanError}</p>}
        </div>
      )}

      {allVenues.length > 0 && remaining === 0 && scanned.length > 0 && (
        <div className="card p-4 border-emerald-500/30 bg-emerald-500/5">
          <p className="text-sm">
            ✅ All {allVenues.length} venues scanned. Review the cards below and
            save the ones you want to keep.
          </p>
        </div>
      )}

      {/* Step 3: preview cards */}
      {scanned.map((row) => (
        <PreviewCard
          key={row.venueId}
          row={row}
          onTogglePhoto={(idx) => togglePhoto(row.venueId, idx)}
          onToggleSaveHours={() => toggleSaveHours(row.venueId)}
          onSave={() => saveOne(row)}
        />
      ))}
    </div>
  );
}

function PreviewCard({
  row,
  onTogglePhoto,
  onToggleSaveHours,
  onSave,
}: {
  row: PreviewState;
  onTogglePhoto: (idx: number) => void;
  onToggleSaveHours: () => void;
  onSave: () => void;
}) {
  return (
    <div
      className={
        "card p-4 " +
        (row.savingState === "saved"
          ? "border-emerald-500/40 bg-emerald-500/5"
          : !row.ok
            ? "border-rose-500/30 bg-rose-500/5"
            : "")
      }
    >
      <div className="flex items-baseline justify-between gap-3 mb-3">
        <h3 className="font-medium">{row.venueName}</h3>
        {row.googleMapsUrl && (
          <a
            href={row.googleMapsUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-buzz-mute hover:text-buzz-accent transition"
          >
            Google Maps ↗
          </a>
        )}
      </div>

      {!row.ok && (
        <p className="text-xs text-rose-400">
          Couldn&apos;t scan: {row.reason ?? "unknown reason"}
        </p>
      )}

      {row.ok && row.photos.length === 0 && row.openingHoursJson == null && (
        <p className="text-xs text-buzz-mute">
          Found the venue but Google had no photos or opening hours listed.
        </p>
      )}

      {row.photos.length > 0 && (
        <div className="mb-3">
          <p className="text-xs text-buzz-mute mb-2">
            Tick which photos to save (up to {MAX_PHOTOS}):
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {row.photos.map((url, idx) => {
              const isSelected = row.selectedPhotoIdxs.has(idx);
              return (
                <button
                  type="button"
                  key={url}
                  onClick={() => onTogglePhoto(idx)}
                  className={
                    "relative aspect-square overflow-hidden rounded-md border-2 transition " +
                    (isSelected
                      ? "border-buzz-accent"
                      : "border-buzz-border opacity-50 hover:opacity-80")
                  }
                >
                  {/* Use plain img to avoid having to whitelist Google's
                      CDN in next.config — these are admin-only previews. */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={url}
                    alt={`Photo ${idx + 1}`}
                    className="w-full h-full object-cover"
                  />
                  {isSelected && (
                    <span className="absolute top-1 right-1 text-xs bg-buzz-accent text-buzz-bg rounded-full w-5 h-5 flex items-center justify-center font-bold">
                      ✓
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {row.openingHoursText && (
        <div className="mb-3">
          <label className="flex items-start gap-2 text-xs cursor-pointer">
            <input
              type="checkbox"
              checked={row.saveHours}
              onChange={onToggleSaveHours}
              className="mt-0.5"
            />
            <span>
              <strong>Save opening hours</strong>
              {row.openingHoursJson == null && (
                <span className="text-rose-400 ml-1">
                  (couldn&apos;t parse Google&apos;s format — review below)
                </span>
              )}
              <pre className="mt-1 text-buzz-mute whitespace-pre-wrap font-mono text-[11px]">
                {row.openingHoursText}
              </pre>
              {row.openingHoursJson && (
                <pre className="mt-1 text-emerald-400 whitespace-pre-wrap font-mono text-[11px]">
                  → parsed as: {JSON.stringify(row.openingHoursJson, null, 2)}
                </pre>
              )}
            </span>
          </label>
        </div>
      )}

      {row.ok && (
        <div className="flex justify-end items-center gap-3 mt-3 pt-3 border-t border-buzz-border/50">
          {row.savingState === "saved" && (
            <span className="text-xs text-emerald-400">✓ Saved</span>
          )}
          {row.savingState === "error" && (
            <span className="text-xs text-rose-400">{row.saveError}</span>
          )}
          <button
            type="button"
            onClick={onSave}
            disabled={
              row.savingState === "saving" ||
              row.savingState === "saved" ||
              (row.selectedPhotoIdxs.size === 0 && !row.saveHours)
            }
            className="btn-primary text-xs"
          >
            {row.savingState === "saving"
              ? "Saving…"
              : row.savingState === "saved"
                ? "Saved"
                : "Save to venue"}
          </button>
        </div>
      )}
    </div>
  );
}
