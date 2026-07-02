"use client";

// Shared review/publish UI for both Quick Import (poster upload) and the
// multi-venue Site Importer. Takes a list of rows (event drafts already
// extracted) and lets the admin map venues + edit fields + publish.

import { useEffect, useRef, useState } from "react";
import {
  searchVenues,
  publishQuickDrafts,
  detectQuickConflicts,
  type QuickDraft,
  type VenueOption,
  type QuickConflict,
  type QuickConflictResolution,
} from "@/app/admin/quick-import/actions";
import { createClient } from "@/lib/supabase/client";
import ArtistChipPicker, { chipArtistToRef, type ChipArtist } from "@/components/ArtistChipPicker";

export type RowVenue =
  | { kind: "existing"; id: string; name: string; city: string | null }
  | {
      kind: "new";
      name: string;
      // Optional cityId override. When null/undefined, the server falls
      // back to Dundee (preserving old behaviour for unscoped imports).
      // The picker UI lets admin choose a city for new venues so
      // Fife/Angus venues don't get filed as Dundee.
      cityId?: string | null;
      cityName?: string | null;
    }
  // No venue — a standalone / townwide event (e.g. a gala). Just a city +
  // an optional location label; the event isn't tied to a place listing.
  | { kind: "none"; cityId?: string | null; cityName?: string | null; locationName?: string | null };

export type Row = {
  key: string;
  posterImageUrl: string;
  draft: QuickDraft;
  venue: RowVenue | null;
  artists: ChipArtist[];
  state: "idle" | "publishing" | "ok" | "error";
  message?: string;
};

// Map an AI venue hint to an existing DB venue, falling back to "new" if no
// reasonable match. Normalisation drops "the " prefix and " bar"/"pub" suffix.
export async function resolveVenueFromHint(hint: string | null): Promise<RowVenue | null> {
  if (!hint) return null;
  const trimmed = hint.trim();
  if (!trimmed) return null;
  const norm = (s: string) =>
    s.toLowerCase()
      .replace(/^the\s+/, "")
      .replace(/\s+(bar|pub|club|lounge|tavern|inn|hotel)\s*$/i, "")
      .trim();
  const queries = [trimmed, norm(trimmed)];
  const seen = new Set<string>();
  let pool: Awaited<ReturnType<typeof searchVenues>> = [];
  for (const q of queries) {
    if (q.length === 0 || seen.has(q.toLowerCase())) continue;
    seen.add(q.toLowerCase());
    const results = await searchVenues(q);
    pool = pool.concat(results);
  }
  const uniq = new Map<string, typeof pool[number]>();
  for (const v of pool) uniq.set(v.id, v);
  const candidates = Array.from(uniq.values());

  const target = norm(trimmed);
  const exact = candidates.find((c) => norm(c.name) === target);
  if (exact) return { kind: "existing", id: exact.id, name: exact.name, city: exact.city };
  const contains = candidates.find((c) => {
    const cn = norm(c.name);
    return cn.includes(target) || target.includes(cn);
  });
  if (contains) return { kind: "existing", id: contains.id, name: contains.name, city: contains.city };
  return { kind: "new", name: trimmed };
}

// A conflict tagged with its panel-wide row index + which group it belongs to,
// so the resolution UI can show the right draft and route the resolution back
// to the correct publishQuickDrafts call.
type PanelConflict = QuickConflict & {
  panelRowIdx: number;
  groupKey: string;
  groupDraftIdx: number; // index within the group's drafts array, used for the resolutions map
};

// Lightweight shape for the city dropdown in the new-venue picker.
// Loaded once at panel mount via the Supabase browser client.
type CityOption = { id: string; name: string; slug: string; active: boolean };

export default function QuickImportReview({
  initialRows,
  onReset,
  resetLabel = "Cancel",
}: {
  initialRows: Row[];
  onReset?: () => void;
  resetLabel?: string;
}) {
  const [rows, setRows] = useState<Row[]>(initialRows);
  const [error, setError] = useState<string | null>(null);
  const [phase, setPhase] = useState<"reviewing" | "checking" | "resolving" | "publishing">("reviewing");
  // Cities for the new-venue city dropdown. Loaded once and shared
  // across all rows so each row's picker doesn't refetch.
  const [cities, setCities] = useState<CityOption[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const sb = createClient();
      const { data } = await sb
        .from("cities")
        .select("id, name, slug, active")
        .order("name");
      if (cancelled) return;
      const list = (data ?? []).map((c: any) => ({
        id: c.id as string,
        name: c.name as string,
        slug: c.slug as string,
        active: !!c.active,
      }));
      setCities(list);
    })();
    return () => { cancelled = true; };
  }, []);
  // Conflicts gathered during the pre-flight check
  const [conflicts, setConflicts] = useState<PanelConflict[]>([]);
  // User's resolutions, keyed by panel row index for stable identity
  const [resolutions, setResolutions] = useState<Record<number, QuickConflictResolution>>({});

  // Refresh local rows if parent ever passes a fresh batch (e.g. after a new import)
  useEffect(() => { setRows(initialRows); }, [initialRows]);

  function updateRow(idx: number, patch: Partial<Row>) {
    setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  }
  function updateDraft(idx: number, patch: Partial<QuickDraft>) {
    setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, draft: { ...r.draft, ...patch } } : r)));
  }
  function removeRow(idx: number) {
    setRows((prev) => prev.filter((_, i) => i !== idx));
  }

  // Build venue groups (existing-id and new-name keys). Returns the same
  // structure for both pre-flight detection and final publish.
  type Group = {
    key: string;
    venueRef:
      | { id: string }
      | { name: string; cityId?: string | null }
      | { standalone: true; cityId?: string | null; locationName?: string | null };
    venueKind: "existing" | "new";
    venueId?: string;
    rows: { row: Row; panelIdx: number; groupIdx: number }[];
  };
  function buildGroups(): { groups: Group[]; missingVenue: number[] } {
    const groups = new Map<string, Group>();
    const missingVenue: number[] = [];
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      if (r.state === "ok") continue;
      if (!r.venue) {
        missingVenue.push(i);
        continue;
      }
      // No-venue (standalone) rows each get their own group — city + location
      // are per-row, and there's no venue to dedupe or conflict-check against.
      if (r.venue.kind === "none") {
        const key = `none:${i}`;
        groups.set(key, {
          key,
          venueRef: { standalone: true, cityId: r.venue.cityId ?? null, locationName: r.venue.locationName ?? null },
          venueKind: "new",
          rows: [{ row: r, panelIdx: i, groupIdx: 0 }],
        });
        continue;
      }
      // Include the chosen cityId in the dedup key so two "new" rows
      // that happen to share a name but were assigned to different
      // cities don't collapse into one venue.
      const key = r.venue.kind === "existing"
        ? `id:${r.venue.id}`
        : `name:${r.venue.name.toLowerCase()}|city:${r.venue.cityId ?? "default"}`;
      const venueRef = r.venue.kind === "existing"
        ? { id: r.venue.id }
        : { name: r.venue.name, cityId: r.venue.cityId ?? null };
      const g = groups.get(key) ?? {
        key,
        venueRef,
        venueKind: r.venue.kind,
        venueId: r.venue.kind === "existing" ? r.venue.id : undefined,
        rows: [],
      };
      g.rows.push({ row: r, panelIdx: i, groupIdx: g.rows.length });
      groups.set(key, g);
    }
    return { groups: Array.from(groups.values()), missingVenue };
  }

  function rowToPublishDraft(row: Row) {
    return {
      title: row.draft.title,
      starts_at: row.draft.starts_at,
      ends_at: row.draft.ends_at,
      description: row.draft.description,
      genres: row.draft.genres,
      artists: row.artists.map(chipArtistToRef),
      confidence: row.draft.confidence,
      cover_charge: row.draft.cover_charge,
      ticket_url: row.draft.ticket_url,
      posterImageUrl: row.posterImageUrl,
    };
  }

  async function publishAll() {
    if (rows.length === 0) return;
    setError(null);
    setPhase("checking");

    const { groups, missingVenue } = buildGroups();
    for (const idx of missingVenue) updateRow(idx, { state: "error", message: "Pick a place, or choose “No specific place”" });

    // Pre-flight: only existing-venue groups can have conflicts (new venues
    // don't exist yet so nothing to clash with).
    const allConflicts: PanelConflict[] = [];
    for (const g of groups) {
      if (g.venueKind !== "existing" || !g.venueId) continue;
      const det = await detectQuickConflicts({
        venueId: g.venueId,
        drafts: g.rows.map(({ row }) => ({ title: row.draft.title, starts_at: row.draft.starts_at })),
      });
      if ("error" in det) {
        setError(det.error);
        setPhase("reviewing");
        return;
      }
      for (const c of det.conflicts) {
        const gr = g.rows[c.draftIdx];
        if (!gr) continue;
        allConflicts.push({ ...c, panelRowIdx: gr.panelIdx, groupKey: g.key, groupDraftIdx: c.draftIdx });
      }
    }

    if (allConflicts.length > 0) {
      // Default everyone to "skip" so the safe option is preselected
      const seed: Record<number, QuickConflictResolution> = {};
      for (const c of allConflicts) seed[c.panelRowIdx] = "skip";
      setConflicts(allConflicts);
      setResolutions(seed);
      setPhase("resolving");
      return;
    }

    await doPublish(groups, {});
  }

  async function doPublish(
    groups: ReturnType<typeof buildGroups>["groups"],
    panelResolutions: Record<number, QuickConflictResolution>,
  ) {
    setPhase("publishing");
    setError(null);

    for (const g of groups) {
      for (const { panelIdx } of g.rows) updateRow(panelIdx, { state: "publishing" });

      // Translate panel-wide resolutions to group-local draftIdx (only for existing-venue groups)
      const groupResolutions: Record<number, QuickConflictResolution> | undefined =
        g.venueKind === "existing"
          ? Object.fromEntries(
              g.rows
                .map(({ panelIdx, groupIdx }) => [groupIdx, panelResolutions[panelIdx]] as const)
                .filter(([, r]) => !!r),
            )
          : undefined;

      const drafts = g.rows.map(({ row }) => rowToPublishDraft(row));
      const result = await publishQuickDrafts({
        venueRef: g.venueRef,
        drafts,
        // Pass an object (even empty) for existing-venue groups so the action
        // knows we're in conflict-aware mode. Skip param entirely for new venues.
        ...(g.venueKind === "existing" ? { resolutions: groupResolutions ?? {} } : {}),
      });

      if ("error" in result) {
        for (const { panelIdx } of g.rows) updateRow(panelIdx, { state: "error", message: result.error });
        continue;
      }
      // Defensive: server raced and found unresolved conflicts. Surface and bail.
      if ("conflicts" in result) {
        setError("Conflicts changed since the check. Please review and try again.");
        for (const { panelIdx } of g.rows) updateRow(panelIdx, { state: "idle" });
        setPhase("reviewing");
        return;
      }

      // Mark per-row state based on the resolution chosen (more informative
      // than mapping back from count fields).
      for (const { panelIdx } of g.rows) {
        const r = panelResolutions[panelIdx];
        if (r === "skip") {
          updateRow(panelIdx, { state: "ok", message: "Kept existing" });
        } else if (r === "replace") {
          updateRow(panelIdx, { state: "ok", message: "Replaced" });
        } else if (r === "keep_both") {
          updateRow(panelIdx, { state: "ok", message: "Published (alongside existing)" });
        } else {
          updateRow(panelIdx, { state: "ok", message: "Published" });
        }
      }
    }

    setPhase("reviewing");
    setConflicts([]);
    setResolutions({});
  }

  function setResolution(panelIdx: number, r: QuickConflictResolution) {
    setResolutions((prev) => ({ ...prev, [panelIdx]: r }));
  }

  // Resolution screen
  if (phase === "resolving" || (phase === "publishing" && conflicts.length > 0)) {
    return (
      <div className="flex flex-col gap-4">
        <div className="card p-4 flex flex-col gap-2">
          <p className="eyebrow text-buzz-accent">Already booked</p>
          <h3 className="h-display text-xl">
            {conflicts.length} of your {rows.length} gig{rows.length === 1 ? "" : "s"} clash with existing events
          </h3>
          <p className="text-buzz-mute text-sm">
            Pick what to do for each. Non-clashing drafts will publish as normal.
          </p>
        </div>

        {error && <div className="card p-3 text-sm text-rose-400">{error}</div>}

        <div className="flex flex-col gap-3">
          {conflicts.map((c) => {
            const newRow = rows[c.panelRowIdx];
            if (!newRow) return null;
            const choice = resolutions[c.panelRowIdx] ?? "skip";
            return (
              <div key={c.panelRowIdx} className="card p-4 flex flex-col gap-3">
                <div className="grid sm:grid-cols-2 gap-3">
                  <div className="border border-buzz-border rounded-lg p-3 bg-buzz-surface/30">
                    <div className="eyebrow text-[10px] mb-2">Already on The Buzz Guide</div>
                    <div className="flex gap-3 items-start">
                      {c.existing.image_url ? (
                        <div
                          className="w-16 h-20 rounded bg-buzz-surface shrink-0 border border-buzz-border"
                          style={{ backgroundImage: `url(${c.existing.image_url})`, backgroundSize: "cover", backgroundPosition: "center" }}
                        />
                      ) : (
                        <div className="w-16 h-20 rounded bg-buzz-surface shrink-0 border border-buzz-border grid place-items-center text-2xl">🎵</div>
                      )}
                      <div className="min-w-0">
                        <div className="font-medium truncate">{c.existing.title}</div>
                        <div className="text-xs text-buzz-mute mt-1">{formatWhen(c.existing.start_time)}</div>
                        {c.existing.auto_imported_from && (
                          <div className="text-[10px] text-buzz-mute mt-1">Source: {c.existing.auto_imported_from}</div>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="border border-buzz-accent/40 rounded-lg p-3 bg-buzz-accent/5">
                    <div className="eyebrow text-[10px] mb-2 text-buzz-accent">Your new draft</div>
                    <div className="flex gap-3 items-start">
                      {newRow.posterImageUrl ? (
                        <div
                          className="w-16 h-20 rounded bg-buzz-surface shrink-0 border border-buzz-border"
                          style={{ backgroundImage: `url(${newRow.posterImageUrl})`, backgroundSize: "cover", backgroundPosition: "center" }}
                        />
                      ) : (
                        <div className="w-16 h-20 rounded bg-buzz-surface shrink-0 border border-buzz-border grid place-items-center text-2xl">📄</div>
                      )}
                      <div className="min-w-0">
                        <div className="font-medium truncate">{newRow.draft.title}</div>
                        <div className="text-xs text-buzz-mute mt-1">{formatWhen(newRow.draft.starts_at)}</div>
                        {newRow.draft.cover_charge && (
                          <div className="text-[10px] text-buzz-mute mt-1">{newRow.draft.cover_charge}</div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="flex flex-wrap gap-2">
                  <ResolutionChip label="Keep existing" hint="Drop my new draft" active={choice === "skip"} onClick={() => setResolution(c.panelRowIdx, "skip")} />
                  <ResolutionChip label="Replace it" hint="Delete the old one, use mine" active={choice === "replace"} onClick={() => setResolution(c.panelRowIdx, "replace")} />
                  <ResolutionChip label="Keep both" hint="Different events at same time" active={choice === "keep_both"} onClick={() => setResolution(c.panelRowIdx, "keep_both")} />
                </div>
              </div>
            );
          })}
        </div>

        <div className="flex gap-2 justify-end">
          <button
            type="button"
            onClick={() => { setConflicts([]); setResolutions({}); setPhase("reviewing"); }}
            disabled={phase === "publishing"}
            className="btn-secondary"
          >
            Back
          </button>
          <button
            type="button"
            onClick={() => {
              const { groups } = buildGroups();
              doPublish(groups, resolutions);
            }}
            disabled={phase === "publishing"}
            className="btn-primary"
          >
            {phase === "publishing" ? "Publishing…" : "Confirm and publish"}
          </button>
        </div>
      </div>
    );
  }

  const allDone = rows.length > 0 && rows.every((r) => r.state === "ok");

  return (
    <div className="flex flex-col gap-4">
      <div className="card p-4 flex items-center justify-between gap-3 flex-wrap">
        <div>
          <p className="eyebrow mb-1">Review</p>
          <h3 className="h-display text-xl">{rows.length} gig{rows.length === 1 ? "" : "s"} found</h3>
        </div>
        <div className="flex gap-2">
          {!allDone && (
            <button
              type="button"
              onClick={publishAll}
              disabled={phase === "checking" || phase === "publishing"}
              className="btn-primary"
            >
              {phase === "checking" ? "Checking for clashes…" : phase === "publishing" ? "Publishing…" : "Publish all"}
            </button>
          )}
          {onReset && (
            <button type="button" onClick={onReset} className="btn-secondary">
              {allDone ? "Done — start over" : resetLabel}
            </button>
          )}
        </div>
      </div>

      {error && <div className="card p-3 text-sm text-rose-400">{error}</div>}

      <div className="grid gap-4">
        {rows.map((r, i) => (
          <RowCard
            key={r.key}
            row={r}
            cities={cities}
            onChangeRow={(patch) => updateRow(i, patch)}
            onChangeDraft={(patch) => updateDraft(i, patch)}
            onRemove={() => removeRow(i)}
          />
        ))}
      </div>
    </div>
  );
}

function RowCard({
  row,
  cities,
  onChangeRow,
  onChangeDraft,
  onRemove,
}: {
  row: Row;
  cities: CityOption[];
  onChangeRow: (patch: Partial<Row>) => void;
  onChangeDraft: (patch: Partial<QuickDraft>) => void;
  onRemove: () => void;
}) {
  const startLocal = toDtLocal(row.draft.starts_at);
  return (
    <div className="card p-4 grid sm:grid-cols-[180px_1fr] gap-4">
      <RowImageEditor
        posterUrl={row.posterImageUrl}
        onChange={(url) => onChangeRow({ posterImageUrl: url })}
      />
      <div className="flex flex-col gap-3 min-w-0">
        <div>
          <label className="label">Title</label>
          <input
            className="input"
            value={row.draft.title}
            onChange={(e) => onChangeDraft({ title: e.target.value })}
            maxLength={200}
          />
        </div>

        <div>
          <label className="label">
            Venue
            {row.draft.venue_hint && (
              <span className="ml-2 text-xs text-buzz-accent font-normal">
                Source says: "{row.draft.venue_hint}"
              </span>
            )}
          </label>
          <VenuePicker
            value={row.venue}
            onChange={(v) => onChangeRow({ venue: v })}
            initialQuery={row.draft.venue_hint ?? ""}
            cities={cities}
          />
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="label">Starts</label>
            <input
              type="datetime-local"
              className="input"
              value={startLocal}
              onChange={(e) => onChangeDraft({ starts_at: fromDtLocal(e.target.value) })}
              style={{ colorScheme: "dark" }}
            />
          </div>
          <div>
            <label className="label">Ends (optional)</label>
            <input
              type="datetime-local"
              className="input"
              value={row.draft.ends_at ? toDtLocal(row.draft.ends_at) : ""}
              onChange={(e) => onChangeDraft({ ends_at: e.target.value ? fromDtLocal(e.target.value) : null })}
              style={{ colorScheme: "dark" }}
            />
          </div>
        </div>

        <div>
          <label className="label">Lineup</label>
          <ArtistChipPicker value={row.artists} onChange={(a) => onChangeRow({ artists: a })} />
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="label">Price / cover</label>
            <input
              className="input"
              value={row.draft.cover_charge ?? ""}
              onChange={(e) => onChangeDraft({ cover_charge: e.target.value || null })}
              placeholder="£10, Free, £8 / £6 conc…"
              maxLength={100}
            />
          </div>
          <div>
            <label className="label">Ticket URL</label>
            <input
              className="input"
              value={row.draft.ticket_url ?? ""}
              onChange={(e) => onChangeDraft({ ticket_url: e.target.value || null })}
              placeholder="https://…"
              maxLength={500}
            />
          </div>
        </div>

        <div>
          <label className="label">Description</label>
          <textarea
            className="input min-h-[60px]"
            value={row.draft.description}
            onChange={(e) => onChangeDraft({ description: e.target.value })}
            maxLength={2000}
          />
        </div>

        <div className="flex items-center justify-between text-xs">
          <span className="text-buzz-mute">
            AI confidence: {(row.draft.confidence * 100).toFixed(0)}%
            {row.draft.genres.length > 0 && <> · Genres: {row.draft.genres.join(", ")}</>}
          </span>
          <div className="flex items-center gap-3">
            {row.state === "publishing" && <span className="text-buzz-accent">publishing…</span>}
            {row.state === "ok" && <span className="text-emerald-400">✓ {row.message}</span>}
            {row.state === "error" && <span className="text-rose-400">✗ {row.message}</span>}
            {row.state !== "ok" && (
              <button type="button" onClick={onRemove} className="text-rose-400 hover:text-rose-300">
                Remove
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// Inline image editor: lets the admin clear or replace the poster on any row.
// Uploads to Supabase Storage under media/events/<uid>/import-replace-…
function RowImageEditor({
  posterUrl,
  onChange,
}: {
  posterUrl: string | null;
  onChange: (newUrl: string) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleFile(file: File) {
    setError(null);
    setBusy(true);
    try {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setError("Not signed in.");
        return;
      }
      // Basic type check — keep it permissive (everything image/*).
      if (!file.type.startsWith("image/")) {
        setError("That doesn't look like an image.");
        return;
      }
      if (file.size > 10 * 1024 * 1024) {
        setError("Image is over 10 MB.");
        return;
      }
      const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
      const path = `events/${user.id}/import-replace-${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from("media")
        .upload(path, file, { upsert: false, contentType: file.type || "image/jpeg" });
      if (upErr) {
        setError(`Upload failed: ${upErr.message}`);
        return;
      }
      const { data } = supabase.storage.from("media").getPublicUrl(path);
      onChange(data.publicUrl);
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  return (
    <div className="flex flex-col gap-2">
      {posterUrl ? (
        <div
          className="aspect-[3/4] rounded-lg bg-buzz-surface border border-buzz-border"
          style={{
            backgroundImage: `url(${posterUrl})`,
            backgroundSize: "contain",
            backgroundPosition: "center",
            backgroundRepeat: "no-repeat",
          }}
        />
      ) : (
        <div className="aspect-[3/4] rounded-lg bg-buzz-surface border border-buzz-border border-dashed grid place-items-center text-3xl text-buzz-mute">
          📄
        </div>
      )}

      <div className="flex flex-col gap-1">
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleFile(f);
          }}
        />
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={busy}
          className="text-[11px] text-buzz-accent hover:underline disabled:opacity-50 text-left"
        >
          {busy ? "Uploading…" : posterUrl ? "Replace image" : "Upload image"}
        </button>
        {posterUrl && !busy && (
          <button
            type="button"
            onClick={() => onChange("")}
            className="text-[11px] text-rose-400 hover:underline text-left"
          >
            Remove image
          </button>
        )}
      </div>
      {error && <div className="text-[11px] text-rose-400">{error}</div>}
    </div>
  );
}

function VenuePicker({
  value,
  onChange,
  initialQuery,
  cities,
}: {
  value: RowVenue | null;
  onChange: (v: RowVenue | null) => void;
  initialQuery: string;
  cities: CityOption[];
}) {
  const [query, setQuery] = useState(initialQuery);
  const [results, setResults] = useState<VenueOption[]>([]);
  const [open, setOpen] = useState(false);
  const ranInitial = useRef(false);

  useEffect(() => {
    let cancelled = false;
    const q = query.trim();
    if (q.length === 0) {
      setResults([]);
      return;
    }
    const timer = setTimeout(async () => {
      const out = await searchVenues(q);
      if (!cancelled) setResults(out);
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query]);

  useEffect(() => {
    if (ranInitial.current) return;
    ranInitial.current = true;
    const q = initialQuery.trim();
    if (q.length > 0) {
      searchVenues(q).then(setResults);
    }
  }, [initialQuery]);

  if (value?.kind === "existing") {
    return (
      <div className="rounded-lg border border-buzz-accent/50 bg-buzz-accent/10 px-3 py-2 flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="text-sm font-medium truncate">{value.name}</div>
          <div className="text-xs text-buzz-mute truncate">{value.city ?? "—"} · existing venue</div>
        </div>
        <button type="button" onClick={() => onChange(null)} className="text-xs text-buzz-mute hover:text-buzz-accent">
          Change
        </button>
      </div>
    );
  }

  if (value?.kind === "new") {
    // Resolve the currently-selected city (if any) into a display name.
    // When cityId is null we say "Dundee (default)" — making it obvious
    // the value is a fallback the admin should review for Fife/Angus
    // venues that landed via the AI import.
    const selected = value.cityId
      ? cities.find((c) => c.id === value.cityId)
      : null;
    const cityLabel = selected
      ? selected.name
      : "Dundee (default — choose city below)";
    return (
      <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="text-sm font-medium truncate">{value.name}</div>
            <div className="text-xs text-emerald-400 truncate">
              Will be created as a new venue · {cityLabel}
            </div>
          </div>
          <button type="button" onClick={() => onChange(null)} className="text-xs text-buzz-mute hover:text-buzz-accent">
            Change
          </button>
        </div>
        {cities.length > 0 && (
          <label className="flex items-center gap-2 text-xs text-buzz-mute">
            <span className="shrink-0">City:</span>
            <select
              className="input text-xs py-1 flex-1"
              value={value.cityId ?? ""}
              onChange={(e) => {
                const cityId = e.target.value || null;
                const city = cities.find((c) => c.id === cityId) ?? null;
                onChange({
                  kind: "new",
                  name: value.name,
                  cityId: cityId,
                  cityName: city?.name ?? null,
                });
              }}
            >
              <option value="">Dundee (default)</option>
              {cities.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                  {!c.active ? " (hidden)" : ""}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
    );
  }

  if (value?.kind === "none") {
    return (
      <div className="rounded-lg border border-buzz-border bg-buzz-surface/40 px-3 py-2 flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="text-sm font-medium">No specific place</div>
            <div className="text-xs text-buzz-mute">Standalone / townwide event — not tied to a venue</div>
          </div>
          <button type="button" onClick={() => onChange(null)} className="text-xs text-buzz-mute hover:text-buzz-accent">Change</button>
        </div>
        <input
          className="input text-xs py-1"
          placeholder="Location label (optional) — e.g. Slessor Gardens"
          value={value.locationName ?? ""}
          onChange={(e) => onChange({ ...value, kind: "none", locationName: e.target.value || null })}
          maxLength={200}
        />
        {cities.length > 0 && (
          <label className="flex items-center gap-2 text-xs text-buzz-mute">
            <span className="shrink-0">Area:</span>
            <select
              className="input text-xs py-1 flex-1"
              value={value.cityId ?? ""}
              onChange={(e) => {
                const cityId = e.target.value || null;
                const city = cities.find((c) => c.id === cityId) ?? null;
                onChange({ kind: "none", cityId, cityName: city?.name ?? null, locationName: value.locationName ?? null });
              }}
            >
              <option value="">Dundee (default)</option>
              {cities.map((c) => (
                <option key={c.id} value={c.id}>{c.name}{!c.active ? " (hidden)" : ""}</option>
              ))}
            </select>
          </label>
        )}
      </div>
    );
  }

  const trimmed = query.trim();
  const hasResults = results.length > 0;
  const exact = results.find((r) => r.name.toLowerCase() === trimmed.toLowerCase());

  return (
    <div className="relative">
      <input
        className="input"
        value={query}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder="Search venue name… or type a new one"
      />
      <button
        type="button"
        onClick={() => onChange({ kind: "none", cityId: null, locationName: trimmed || null })}
        className="mt-1 text-[11px] text-buzz-mute hover:text-buzz-accent"
      >
        📍 No specific place (standalone / townwide event)
      </button>
      {open && trimmed.length > 0 && (
        <div className="absolute z-20 mt-1 w-full rounded-lg bg-buzz-card border border-buzz-border shadow-lg overflow-hidden">
          {hasResults &&
            results.map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={() => onChange({ kind: "existing", id: r.id, name: r.name, city: r.city })}
                className="w-full text-left px-3 py-2 text-sm hover:bg-buzz-surface transition flex items-center justify-between"
              >
                <span>
                  <span className="font-medium">{r.name}</span>
                  <span className="text-xs text-buzz-mute ml-2">{r.city ?? "—"}</span>
                </span>
                {!r.approved && <span className="text-xs text-buzz-accent">pending</span>}
              </button>
            ))}
          {!exact && trimmed.length >= 2 && (
            <button
              type="button"
              onClick={() => onChange({ kind: "new", name: trimmed })}
              className="w-full text-left px-3 py-2 text-sm hover:bg-buzz-surface transition border-t border-buzz-border bg-buzz-surface/50"
            >
              ➕ Add <span className="font-medium">{trimmed}</span> as a new venue
            </button>
          )}
          {!hasResults && trimmed.length < 2 && (
            <div className="px-3 py-2 text-sm text-buzz-mute">Keep typing…</div>
          )}
        </div>
      )}
    </div>
  );
}

function toDtLocal(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fromDtLocal(value: string): string {
  if (!value) return "";
  return new Date(value).toISOString();
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
