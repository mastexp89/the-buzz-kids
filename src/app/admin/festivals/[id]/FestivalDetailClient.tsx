"use client";

import { useRef, useState, useTransition, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  updateFestival,
  searchVenuesForFestival,
  searchExistingVenuesForName,
  addVenueToFestival,
  removeVenueFromFestival,
  bulkAddVenuesByName,
  createVenueAndLinkToFestival,
  regenerateFestivalPreviewToken,
  addFestivalLineupAct,
  updateFestivalLineupAct,
  deleteFestivalLineupAct,
  createFestivalSponsor,
  updateFestivalSponsor,
  deleteFestivalSponsor,
  reorderFestivalSponsors,
  type FestivalRow,
  type FestivalVenueRow,
  type VenueSearchResult,
  type FestivalLineupRow,
  type FestivalSponsorRow,
} from "../actions";

export default function FestivalDetailClient({
  festival,
  venues: initialVenues,
  initialLineup,
  initialSponsors,
}: {
  festival: FestivalRow;
  venues: FestivalVenueRow[];
  initialLineup: FestivalLineupRow[];
  initialSponsors: FestivalSponsorRow[];
}) {
  const [venues, setVenues] = useState(initialVenues);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <p className="eyebrow mt-3 mb-1">Admin · Festival</p>
        <h1 className="h-display text-4xl">{festival.name}</h1>
      </div>

      <FestivalEditor festival={festival} />

      <PreviewLinkCard festival={festival} />

      {/* "With thanks to" grid of extra sponsors (sql/062). The headline
          sponsor stays in the form above; this is for the long tail of
          smaller supporters that festivals like to thank on their page. */}
      <ExtraSponsorsManager
        festivalId={festival.id}
        initialRows={initialSponsors}
      />

      <LineupManager
        festivalId={festival.id}
        festivalStartDate={festival.start_date}
        festivalEndDate={festival.end_date}
        initialRows={initialLineup}
      />

      <VenueManager
        festivalId={festival.id}
        venues={venues}
        onAdd={(v) => setVenues((prev) => prev.some((x) => x.id === v.id) ? prev : [...prev, v])}
        onRemove={(id) => setVenues((prev) => prev.filter((v) => v.id !== id))}
        onReplaceAll={(vs) => setVenues(vs)}
      />
    </div>
  );
}

function FestivalEditor({
  festival,
}: {
  festival: FestivalRow;
}) {
  const [form, setForm] = useState({
    name: festival.name,
    start_date: festival.start_date,
    end_date: festival.end_date,
    tagline: festival.tagline ?? "",
    description: festival.description ?? "",
    primary_color: festival.primary_color ?? "#e91e63",
    hero_image_url: festival.hero_image_url ?? "",
    hero_image_position: festival.hero_image_position ?? "center",
    hero_image_opacity: festival.hero_image_opacity ?? 0.5,
    hero_image_blur: festival.hero_image_blur ?? 24,
    logo_url: festival.logo_url ?? "",
    map_image_url: festival.map_image_url ?? "",
    sponsor_name: festival.sponsor_name ?? "",
    sponsor_logo_url: festival.sponsor_logo_url ?? "",
    sponsor_url: festival.sponsor_url ?? "",
    contact_email: festival.contact_email ?? "",
    accepting_artists: festival.accepting_artists,
    sponsor_text: festival.sponsor_text ?? "",
    ticket_url: festival.ticket_url ?? "",
    act_count_label: festival.act_count_label ?? "",
    venue_count_label: festival.venue_count_label ?? "",
    // Layout mode — controls which tabs render on the public page.
    // Defaults to 'multi_venue' to preserve existing festivals.
    layout_mode: (festival.layout_mode as "multi_venue" | "programme") ?? "multi_venue",
    programme_content: festival.programme_content ?? "",
    published: festival.published,
  });
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function field<K extends keyof typeof form>(k: K, v: typeof form[K]) {
    setForm((prev) => ({ ...prev, [k]: v }));
    setSaved(false);
  }

  async function save() {
    setBusy(true);
    setError(null);
    const r = await updateFestival(festival.id, form);
    setBusy(false);
    if ("error" in r) {
      setError(r.error);
      return;
    }
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  }

  return (
    <section className="card p-5 flex flex-col gap-3">
      <h2 className="h-display text-xl">Details</h2>

      <div>
        <label className="label">Name</label>
        <input className="input" value={form.name} onChange={(e) => field("name", e.target.value)} />
      </div>

      <div className="grid sm:grid-cols-2 gap-3">
        <div>
          <label className="label">Start date</label>
          <input type="date" className="input" value={form.start_date} onChange={(e) => field("start_date", e.target.value)} style={{ colorScheme: "dark" }} />
        </div>
        <div>
          <label className="label">End date</label>
          <input type="date" className="input" value={form.end_date} onChange={(e) => field("end_date", e.target.value)} style={{ colorScheme: "dark" }} />
        </div>
      </div>

      <div>
        <label className="label">Tagline</label>
        <input className="input" value={form.tagline} onChange={(e) => field("tagline", e.target.value)} placeholder="2 days, 100+ acts, 45+ venues" />
      </div>

      <div>
        <label className="label">Description / about the festival</label>
        <textarea
          className="input min-h-[200px] font-mono text-sm"
          value={form.description}
          onChange={(e) => field("description", e.target.value)}
          placeholder={"🥁🥁 MOFEST HIGH ST '26 🥁🥁\n\nGet ready for an amazing day packed with live music, food, drinks, shopping…\n\n🎶 LIVE ENTERTAINMENT\n…"}
        />
        <p className="help">
          Shown above the tabs on the public festival page. Supports emoji
          and <strong>markdown formatting</strong>: <code>**bold**</code>,{" "}
          <code>*italic*</code>, <code>## Heading</code>,{" "}
          <code>- bullet</code>, <code>[link](https://…)</code>, and{" "}
          <code>---</code> for a divider. Blank lines = paragraph breaks.
          Old plain-text descriptions still render unchanged.
        </p>
      </div>

      <div>
        <label className="label">Page layout</label>
        <select
          className="input"
          value={form.layout_mode}
          onChange={(e) => field("layout_mode", e.target.value as "multi_venue" | "programme")}
        >
          <option value="multi_venue">Multi-venue (default) — Schedule · Venues · Artists · Map · Picks</option>
          <option value="programme">Programme — single-park festival, no Venues / Map tabs</option>
        </select>
        <p className="help">
          Pick <strong>Programme</strong> for festivals that all happen in one
          park / building with multiple zones (Bruce, community festivals).
          Hides the Venues + Map tabs and adds a Programme tab with rich content.
        </p>
      </div>

      {form.layout_mode === "programme" && (
        <div>
          <label className="label">Programme content</label>
          <textarea
            className="input min-h-[300px] font-mono text-sm"
            value={form.programme_content}
            onChange={(e) => field("programme_content", e.target.value)}
            placeholder={"## Saturday\n\n### ⚔️ Medieval Arena\n- 10:30 Opening Ceremony & Pipe Band Parade\n- 11:00 Pipe Band\n- 11:40 Les Amis Jousting\n\n### 🧙 Magical Medieval Arena\n- 11:00 Jester Show\n- 12:15 Re-enactment Battle (Kids)\n\n## All day (both days)\n- Re-enactment village, storytellers, squires' training\n- Artisan market, beer tent, food stalls\n\n## 🚌 Travel & Parking\nFree vintage shuttle buses between Leys Park and the Glen…"}
          />
          <p className="help">
            Long-form schedule + travel info. Same markdown features as the
            description above. Use <code>##</code> for big sections,{" "}
            <code>###</code> for sub-sections, <code>-</code> for bullets.
          </p>
        </div>
      )}

      <div>
        <label className="label">Theme colour</label>
        <div className="flex items-center gap-2">
          <input type="color" value={form.primary_color} onChange={(e) => field("primary_color", e.target.value)} className="w-12 h-10 rounded cursor-pointer bg-buzz-surface border border-buzz-border" />
          <input className="input flex-1" value={form.primary_color} onChange={(e) => field("primary_color", e.target.value)} />
        </div>
      </div>

      <div>
        <label className="label">Hero image</label>
        <HeroImageUpload
          festivalId={festival.id}
          value={form.hero_image_url}
          onChange={(url) => field("hero_image_url", url)}
        />
        {form.hero_image_url && (
          <>
            <HeroPositionPicker
              imageUrl={form.hero_image_url}
              value={form.hero_image_position}
              opacity={form.hero_image_opacity}
              blurPx={form.hero_image_blur}
              onChange={(pos) => field("hero_image_position", pos)}
            />
            <HeroOpacitySlider
              value={form.hero_image_opacity}
              onChange={(v) => field("hero_image_opacity", v)}
            />
            <HeroBlurSlider
              value={form.hero_image_blur}
              onChange={(v) => field("hero_image_blur", v)}
            />
          </>
        )}
      </div>

      <div>
        <label className="label">Logo (square)</label>
        <HeroImageUpload
          festivalId={festival.id}
          value={form.logo_url}
          onChange={(url) => field("logo_url", url)}
          variant="logo"
        />
        <p className="help">Square brand mark — shown on event cards and admin tools. PNG with transparent background works best.</p>
      </div>

      <div>
        <label className="label">Site map / illustrated map</label>
        <HeroImageUpload
          festivalId={festival.id}
          value={form.map_image_url}
          onChange={(url) => field("map_image_url", url)}
          variant="map"
        />
        <p className="help">Optional. Sits at the top of the festival page&apos;s <strong>Map</strong> tab, above the live venue map. Use the illustrated site map showing stages, food trucks, kids rides, etc.</p>
      </div>

      <div>
        <label className="label">Contact email</label>
        <input
          className="input"
          type="email"
          value={form.contact_email}
          onChange={(e) => field("contact_email", e.target.value)}
          placeholder="bookings@example.com"
        />
        <p className="help">Where artist submissions land. Leave blank to hide the &quot;Want to play?&quot; CTAs entirely.</p>
      </div>

      <div className="flex items-start gap-2">
        <input
          type="checkbox"
          id="accepting_artists"
          checked={form.accepting_artists}
          onChange={(e) => field("accepting_artists", e.target.checked)}
          className="cursor-pointer mt-1"
        />
        <label htmlFor="accepting_artists" className="text-sm cursor-pointer">
          <span className="font-medium">Accepting artist submissions</span>
          <p className="text-xs text-buzz-mute mt-0.5">
            Tick to show the &quot;Want to be involved?&quot; banner + ArtistsGrid &quot;Want to play?&quot; CTA on the public page. Untick when the lineup is full — admins can still see the contact email above for their own reference.
          </p>
        </label>
      </div>

      <div className="card p-4 bg-buzz-surface/40 flex flex-col gap-3">
        <div>
          <div className="eyebrow text-[10px]">Headline sponsor</div>
          <p className="text-xs text-buzz-mute mt-1">
            Standalone sponsor for this festival only — not linked to the Buzz advertiser programme. Renders as a logo + name card above the description on the public festival page. Leave name blank to hide the card entirely.
          </p>
        </div>

        <div>
          <label className="label">Sponsor name</label>
          <input
            className="input"
            value={form.sponsor_name}
            onChange={(e) => field("sponsor_name", e.target.value)}
            placeholder="GoFibre"
          />
        </div>

        <div>
          <label className="label">Sponsor logo</label>
          <HeroImageUpload
            festivalId={festival.id}
            value={form.sponsor_logo_url}
            onChange={(url) => field("sponsor_logo_url", url)}
            variant="logo"
          />
          <p className="help">Square logo works best. Falls back to the first two letters of the sponsor name if no logo is uploaded.</p>
        </div>

        <div>
          <label className="label">Sponsor website (optional)</label>
          <input
            className="input"
            type="url"
            value={form.sponsor_url}
            onChange={(e) => field("sponsor_url", e.target.value)}
            placeholder="https://gofibre.co.uk"
          />
          <p className="help">When set, the sponsor card becomes a clickable link with the sponsor&apos;s URL (opens in a new tab).</p>
        </div>
      </div>

      <div>
        <label className="label">Sponsor text (legacy / extra credits)</label>
        <input className="input" value={form.sponsor_text} onChange={(e) => field("sponsor_text", e.target.value)} placeholder="In partnership with Madri, J.F. Kegs" />
        <p className="help">Free-text credits shown in the hero footer. Use this for the &quot;in partnership with&quot; line; use <strong>Headline sponsor</strong> above for the big logo card.</p>
      </div>

      <div className="grid sm:grid-cols-2 gap-3">
        <div>
          <label className="label">Acts label override</label>
          <input
            className="input"
            value={form.act_count_label}
            onChange={(e) => field("act_count_label", e.target.value)}
            placeholder="100+ (leave blank for live count)"
          />
        </div>
        <div>
          <label className="label">Venues label override</label>
          <input
            className="input"
            value={form.venue_count_label}
            onChange={(e) => field("venue_count_label", e.target.value)}
            placeholder="40+ (leave blank for live count)"
          />
        </div>
      </div>

      <div>
        <label className="label">Ticket URL (optional)</label>
        <input className="input" value={form.ticket_url} onChange={(e) => field("ticket_url", e.target.value)} placeholder="https://..." />
      </div>

      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          id="published"
          checked={form.published}
          onChange={(e) => field("published", e.target.checked)}
          className="cursor-pointer"
        />
        <label htmlFor="published" className="text-sm cursor-pointer">
          Published — visible at <code>/festivals/{festival.slug}</code> and via the browse filter
        </label>
      </div>

      {error && <div className="text-sm text-rose-400">{error}</div>}

      <div className="flex items-center gap-2">
        <button type="button" onClick={save} disabled={busy} className="btn-primary">
          {busy ? "Saving…" : "Save changes"}
        </button>
        {saved && <span className="text-sm text-emerald-400">✓ Saved</span>}
      </div>
    </section>
  );
}

// Lineup manager — admin types in act names with times + stages.
// Each name auto-creates an `artists` row (or links to an existing one
// by slug) so the typed-in acts get real /artists/<slug> pages, link
// targets in the Artists tab on the festival page, and benefit from
// the rest of the artist tooling (FB photo puller etc.).
// Manages the "with thanks to" grid of extra sponsors below the headline
// sponsor card. Each row: logo + name + optional website link. Admin can
// reorder with up/down buttons; sort_order is persisted server-side.
//
// Kept simple — no drag-and-drop, no tier system. Sponsors that need
// special prominence go in the headline sponsor field in the editor above.
function ExtraSponsorsManager({
  festivalId,
  initialRows,
}: {
  festivalId: string;
  initialRows: FestivalSponsorRow[];
}) {
  const [rows, setRows] = useState(initialRows);
  const [showAdd, setShowAdd] = useState(false);
  const [newName, setNewName] = useState("");
  const [newUrl, setNewUrl] = useState("");
  const [newLogoUrl, setNewLogoUrl] = useState("");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function addSponsor(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!newName.trim()) {
      setError("Sponsor name is required.");
      return;
    }
    startTransition(async () => {
      const r = await createFestivalSponsor({
        festivalId,
        name: newName,
        url: newUrl || null,
        logoUrl: newLogoUrl || null,
      });
      if ("error" in r) {
        setError(r.error);
        return;
      }
      setRows((prev) => [...prev, r.row]);
      setNewName("");
      setNewUrl("");
      setNewLogoUrl("");
      setShowAdd(false);
    });
  }

  function moveRow(id: string, direction: -1 | 1) {
    const idx = rows.findIndex((r) => r.id === id);
    const target = idx + direction;
    if (idx < 0 || target < 0 || target >= rows.length) return;
    // Swap locally, then persist the new order.
    const next = [...rows];
    [next[idx], next[target]] = [next[target], next[idx]];
    setRows(next);
    startTransition(async () => {
      const r = await reorderFestivalSponsors(festivalId, next.map((x) => x.id));
      if ("error" in r) {
        setError(r.error);
        // Roll back optimistic swap so the UI matches reality.
        setRows(rows);
      }
    });
  }

  return (
    <section className="card p-5 flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <h2 className="h-display text-xl">Extra sponsors</h2>
          <p className="text-xs text-buzz-mute mt-1">
            Smaller supporters shown as a &quot;With thanks to&quot; grid below the
            headline sponsor on the public page. Headline sponsor lives in the
            editor above.
          </p>
        </div>
        {!showAdd && (
          <button
            type="button"
            onClick={() => setShowAdd(true)}
            className="btn-secondary text-xs"
          >
            + Add sponsor
          </button>
        )}
      </div>

      {rows.length === 0 && !showAdd && (
        <div className="card p-6 text-center text-buzz-mute text-sm">
          No extra sponsors yet. Click <strong>+ Add sponsor</strong> to start.
        </div>
      )}

      {rows.length > 0 && (
        <ul className="divide-y divide-buzz-border/60">
          {rows.map((row, idx) => (
            <ExtraSponsorRowItem
              key={row.id}
              festivalId={festivalId}
              row={row}
              isFirst={idx === 0}
              isLast={idx === rows.length - 1}
              onMoveUp={() => moveRow(row.id, -1)}
              onMoveDown={() => moveRow(row.id, 1)}
              onUpdate={(patch) => {
                setRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, ...patch } : r)));
              }}
              onDelete={() => {
                setRows((prev) => prev.filter((r) => r.id !== row.id));
              }}
            />
          ))}
        </ul>
      )}

      {showAdd && (
        <form onSubmit={addSponsor} className="card p-3 flex flex-col gap-3 border-buzz-accent/30">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="label">Sponsor name</label>
              <input
                className="input"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Dunfermline Press"
                autoFocus
              />
            </div>
            <div>
              <label className="label">Website (optional)</label>
              <input
                className="input"
                type="url"
                value={newUrl}
                onChange={(e) => setNewUrl(e.target.value)}
                placeholder="https://dunfermlinepress.com"
              />
            </div>
          </div>
          <div>
            <label className="label">Logo (optional)</label>
            <HeroImageUpload
              festivalId={festivalId}
              value={newLogoUrl}
              onChange={setNewLogoUrl}
              variant="logo"
            />
            <p className="help">No logo? Just the name will show.</p>
          </div>
          {error && <p className="text-xs text-rose-400">{error}</p>}
          <div className="flex gap-2 justify-end">
            <button
              type="button"
              onClick={() => { setShowAdd(false); setNewName(""); setNewUrl(""); setNewLogoUrl(""); setError(null); }}
              className="btn-secondary text-xs"
              disabled={pending}
            >
              Cancel
            </button>
            <button type="submit" className="btn-primary text-xs" disabled={pending}>
              {pending ? "Adding…" : "Add sponsor"}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}

function ExtraSponsorRowItem({
  festivalId,
  row,
  isFirst,
  isLast,
  onMoveUp,
  onMoveDown,
  onUpdate,
  onDelete,
}: {
  festivalId: string;
  row: FestivalSponsorRow;
  isFirst: boolean;
  isLast: boolean;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onUpdate: (patch: Partial<FestivalSponsorRow>) => void;
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(row.name);
  const [url, setUrl] = useState(row.url ?? "");
  const [logoUrl, setLogoUrl] = useState(row.logo_url ?? "");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function save() {
    setError(null);
    startTransition(async () => {
      const r = await updateFestivalSponsor(row.id, {
        name,
        url: url || null,
        logoUrl: logoUrl || null,
      });
      if ("error" in r) {
        setError(r.error);
        return;
      }
      onUpdate({ name, url: url || null, logo_url: logoUrl || null });
      setEditing(false);
    });
  }

  function remove() {
    if (!confirm(`Remove "${row.name}" from this festival's sponsors?`)) return;
    startTransition(async () => {
      const r = await deleteFestivalSponsor(row.id);
      if ("error" in r) {
        setError(r.error);
        return;
      }
      onDelete();
    });
  }

  if (editing) {
    return (
      <li className="py-3">
        <div className="card p-3 flex flex-col gap-3 border-buzz-accent/30">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="label">Name</label>
              <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div>
              <label className="label">Website</label>
              <input
                className="input"
                type="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://…"
              />
            </div>
          </div>
          <div>
            <label className="label">Logo</label>
            <HeroImageUpload
              festivalId={festivalId}
              value={logoUrl}
              onChange={setLogoUrl}
              variant="logo"
            />
          </div>
          {error && <p className="text-xs text-rose-400">{error}</p>}
          <div className="flex gap-2 justify-end">
            <button
              type="button"
              onClick={() => { setEditing(false); setName(row.name); setUrl(row.url ?? ""); setLogoUrl(row.logo_url ?? ""); setError(null); }}
              className="btn-secondary text-xs"
              disabled={pending}
            >
              Cancel
            </button>
            <button type="button" onClick={save} className="btn-primary text-xs" disabled={pending}>
              {pending ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      </li>
    );
  }

  return (
    <li className="py-3 flex items-center gap-3">
      {row.logo_url ? (
        <div
          className="w-12 h-12 rounded-md bg-buzz-surface border border-buzz-border shrink-0"
          style={{
            backgroundImage: `url(${row.logo_url})`,
            backgroundSize: "contain",
            backgroundPosition: "center",
            backgroundRepeat: "no-repeat",
          }}
        />
      ) : (
        <div className="w-12 h-12 rounded-md bg-buzz-surface border border-buzz-border grid place-items-center text-xs text-buzz-mute shrink-0">
          —
        </div>
      )}
      <div className="min-w-0 flex-1">
        <div className="font-medium truncate">{row.name}</div>
        {row.url && (
          <a
            href={row.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-buzz-mute hover:text-buzz-accent truncate block"
          >
            {row.url}
          </a>
        )}
      </div>
      <div className="flex gap-1 shrink-0">
        <button
          type="button"
          onClick={onMoveUp}
          disabled={isFirst || pending}
          className="btn-secondary text-xs px-2"
          title="Move up"
          aria-label="Move up"
        >
          ↑
        </button>
        <button
          type="button"
          onClick={onMoveDown}
          disabled={isLast || pending}
          className="btn-secondary text-xs px-2"
          title="Move down"
          aria-label="Move down"
        >
          ↓
        </button>
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="btn-secondary text-xs"
          disabled={pending}
        >
          Edit
        </button>
        <button
          type="button"
          onClick={remove}
          className="btn-secondary text-xs text-rose-400"
          disabled={pending}
        >
          Remove
        </button>
      </div>
    </li>
  );
}

function LineupManager({
  festivalId,
  festivalStartDate,
  festivalEndDate,
  initialRows,
}: {
  festivalId: string;
  festivalStartDate: string;
  festivalEndDate: string;
  initialRows: FestivalLineupRow[];
}) {
  const [rows, setRows] = useState(initialRows);
  const [showAdd, setShowAdd] = useState(initialRows.length === 0);
  const [newName, setNewName] = useState("");
  // Default the new-act time to the start of the festival's first day so
  // the admin doesn't have to tab through years before picking a real
  // time. They can clear it for TBA.
  const [newTime, setNewTime] = useState<string>(`${festivalStartDate}T19:00`);
  const [newTimeTba, setNewTimeTba] = useState(false);
  const [newStage, setNewStage] = useState("");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function addAct(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!newName.trim()) return;
    startTransition(async () => {
      const r = await addFestivalLineupAct({
        festivalId,
        name: newName,
        performance_time: newTimeTba ? null : new Date(newTime).toISOString(),
        stage: newStage || null,
      });
      if ("error" in r) {
        setError(r.error);
        return;
      }
      setRows((prev) => [...prev, r.row].sort(sortLineup));
      setNewName("");
      setNewStage("");
      // Keep the same time + TBA-flag for the next act so adding "Sergeant
      // at 19:00 then Kyle Falconer at 20:00 on the same stage" is a few
      // taps rather than re-typing everything.
    });
  }

  return (
    <section className="card p-5 flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="h-display text-xl">Lineup</h2>
        <p className="text-xs text-buzz-mute">
          Type acts, set times + stage. Each act gets a real artist page.
        </p>
      </div>

      {rows.length === 0 && !showAdd && (
        <div className="card p-6 text-center text-buzz-mute text-sm">
          No acts yet. Click <strong>+ Add act</strong> to start the lineup.
        </div>
      )}

      {rows.length > 0 && (
        <ul className="divide-y divide-buzz-border/60">
          {rows.map((row) => (
            <LineupRowItem
              key={row.id}
              row={row}
              onUpdate={(patch) => {
                setRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, ...patch } : r)).sort(sortLineup));
              }}
              onDelete={() => {
                setRows((prev) => prev.filter((r) => r.id !== row.id));
              }}
            />
          ))}
        </ul>
      )}

      {showAdd ? (
        <form onSubmit={addAct} className="card p-3 flex flex-col gap-2 bg-buzz-bg/40">
          <div className="grid sm:grid-cols-4 gap-2 items-end">
            <div className="sm:col-span-2">
              <label className="label">Artist name</label>
              <input
                className="input"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Kyle Falconer"
                autoFocus
                required
              />
            </div>
            <div>
              <label className="label">Stage (optional)</label>
              <input
                className="input"
                value={newStage}
                onChange={(e) => setNewStage(e.target.value)}
                placeholder="Music Zone"
              />
            </div>
            <div>
              <label className="label">
                Time {newTimeTba && <span className="text-buzz-mute">(TBA)</span>}
              </label>
              <input
                type="datetime-local"
                className="input"
                value={newTime}
                onChange={(e) => setNewTime(e.target.value)}
                disabled={newTimeTba}
                // Constrain to the festival's date range so the picker
                // jumps straight to the right month.
                min={`${festivalStartDate}T00:00`}
                max={`${festivalEndDate}T23:59`}
                style={{ colorScheme: "dark" }}
              />
            </div>
          </div>
          <label className="text-xs flex items-center gap-2 text-buzz-mute">
            <input
              type="checkbox"
              checked={newTimeTba}
              onChange={(e) => setNewTimeTba(e.target.checked)}
            />
            Time TBA (don&apos;t show a time yet)
          </label>
          {error && <div className="text-sm text-rose-400">{error}</div>}
          <div className="flex gap-2">
            <button type="submit" disabled={pending || !newName.trim()} className="btn-primary text-sm">
              {pending ? "Adding…" : "Add act"}
            </button>
            <button
              type="button"
              onClick={() => { setShowAdd(false); setError(null); }}
              className="btn-ghost text-sm"
            >
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <button
          type="button"
          onClick={() => setShowAdd(true)}
          className="btn-secondary self-start text-sm"
        >
          + Add act
        </button>
      )}
    </section>
  );
}

// Single lineup row in the manager list — name (read-only, the artist
// row owns it), inline editable time + stage, delete button. We don't
// allow renaming here because the artist row is shared across pages;
// to rename, the admin should edit the artist directly.
function LineupRowItem({
  row,
  onUpdate,
  onDelete,
}: {
  row: FestivalLineupRow;
  onUpdate: (patch: Partial<FestivalLineupRow>) => void;
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draftTime, setDraftTime] = useState<string>(
    row.performance_time ? toLocalInputValue(row.performance_time) : "",
  );
  const [draftTba, setDraftTba] = useState(row.performance_time == null);
  const [draftStage, setDraftStage] = useState(row.stage ?? "");
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    const r = await updateFestivalLineupAct(row.id, {
      performance_time: draftTba ? null : (draftTime ? new Date(draftTime).toISOString() : null),
      stage: draftStage || null,
    });
    setBusy(false);
    if ("error" in r) {
      alert(`Couldn't save: ${r.error}`);
      return;
    }
    onUpdate({
      performance_time: draftTba ? null : (draftTime ? new Date(draftTime).toISOString() : null),
      stage: draftStage || null,
    });
    setEditing(false);
  }

  async function remove() {
    if (!confirm(`Remove ${row.artist_name} from the lineup?`)) return;
    setBusy(true);
    const r = await deleteFestivalLineupAct(row.id);
    setBusy(false);
    if ("error" in r) {
      alert(`Couldn't delete: ${r.error}`);
      return;
    }
    onDelete();
  }

  if (editing) {
    return (
      <li className="py-3 flex flex-col gap-2">
        <div className="font-medium text-sm">{row.artist_name}</div>
        <div className="grid sm:grid-cols-2 gap-2">
          <div>
            <label className="text-[10px] uppercase tracking-wider text-buzz-mute">Time</label>
            <input
              type="datetime-local"
              className="input text-sm"
              value={draftTime}
              onChange={(e) => setDraftTime(e.target.value)}
              disabled={draftTba}
              style={{ colorScheme: "dark" }}
            />
          </div>
          <div>
            <label className="text-[10px] uppercase tracking-wider text-buzz-mute">Stage</label>
            <input
              className="input text-sm"
              value={draftStage}
              onChange={(e) => setDraftStage(e.target.value)}
              placeholder="Music Zone"
            />
          </div>
        </div>
        <label className="text-xs flex items-center gap-2 text-buzz-mute">
          <input type="checkbox" checked={draftTba} onChange={(e) => setDraftTba(e.target.checked)} />
          Time TBA
        </label>
        <div className="flex gap-2">
          <button type="button" onClick={save} disabled={busy} className="btn-primary text-xs">
            {busy ? "Saving…" : "Save"}
          </button>
          <button type="button" onClick={() => setEditing(false)} className="btn-ghost text-xs">Cancel</button>
        </div>
      </li>
    );
  }

  return (
    <li className="py-3 flex items-center gap-3">
      <div className="flex-1 min-w-0">
        <div className="font-medium truncate">{row.artist_name}</div>
        <div className="text-xs text-buzz-mute">
          {row.performance_time ? formatLineupTime(row.performance_time) : "Time TBA"}
          {row.stage && <> · <span>{row.stage}</span></>}
          {row.artist_slug && (
            <> · <a href={`/artists/${row.artist_slug}`} target="_blank" rel="noreferrer" className="hover:text-buzz-accent">view artist page ↗</a></>
          )}
        </div>
      </div>
      <div className="flex gap-2 shrink-0">
        <button type="button" onClick={() => setEditing(true)} className="btn-ghost text-xs" disabled={busy}>
          Edit
        </button>
        <button type="button" onClick={remove} className="text-xs text-rose-400 hover:text-rose-300 px-2" disabled={busy}>
          Delete
        </button>
      </div>
    </li>
  );
}

// Sort lineup rows: chronologically by time, then alphabetical for
// TBA acts at the end. Used everywhere the list is mutated locally.
function sortLineup(a: FestivalLineupRow, b: FestivalLineupRow): number {
  const at = a.performance_time;
  const bt = b.performance_time;
  if (at && bt) return at.localeCompare(bt);
  if (at) return -1;
  if (bt) return 1;
  return a.artist_name.localeCompare(b.artist_name);
}

// Format an ISO timestamp for the admin row display — "Sat 19:00".
// Public-page formatting is in lib/utils; this is just a compact label.
function formatLineupTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("en-GB", {
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// Convert an ISO timestamp into the local "YYYY-MM-DDTHH:MM" string
// that <input type="datetime-local"> expects. The native input
// doesn't accept Z-suffixed UTC ISO strings.
function toLocalInputValue(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function VenueManager({
  festivalId,
  venues,
  onAdd,
  onRemove,
  onReplaceAll,
}: {
  festivalId: string;
  venues: FestivalVenueRow[];
  onAdd: (v: FestivalVenueRow) => void;
  onRemove: (id: string) => void;
  onReplaceAll: (vs: FestivalVenueRow[]) => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<VenueSearchResult[]>([]);
  const [bulkText, setBulkText] = useState("");
  const [bulkResult, setBulkResult] = useState<{ matched: { input: string; venueName: string }[]; unmatched: string[] } | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  // Unmatched names from the most-recent bulk add. Stays around so admin can
  // work through them one by one with the search/create flow below.
  const [unmatched, setUnmatched] = useState<string[]>([]);
  const [, startTransition] = useTransition();

  // Search-as-you-type
  useEffect(() => {
    let cancelled = false;
    const t = setTimeout(async () => {
      if (query.trim().length === 0) {
        setResults([]);
        return;
      }
      const r = await searchVenuesForFestival(festivalId, query);
      if (!cancelled) setResults(r);
    }, 200);
    return () => { cancelled = true; clearTimeout(t); };
  }, [query, festivalId]);

  async function add(v: VenueSearchResult) {
    const r = await addVenueToFestival(festivalId, v.id);
    if ("error" in r) { alert(r.error); return; }
    onAdd({ id: v.id, name: v.name, slug: v.slug, city: v.city, approved: v.approved, sort_order: 0 });
    setResults((prev) => prev.map((x) => x.id === v.id ? { ...x, alreadyAssigned: true } : x));
  }

  async function remove(id: string) {
    if (!confirm("Remove this venue from the festival?")) return;
    startTransition(async () => {
      const r = await removeVenueFromFestival(festivalId, id);
      if ("error" in r) { alert(r.error); return; }
      onRemove(id);
      setResults((prev) => prev.map((x) => x.id === id ? { ...x, alreadyAssigned: false } : x));
    });
  }

  async function runBulk() {
    const names = bulkText.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    if (names.length === 0) return;
    setBulkBusy(true);
    const r = await bulkAddVenuesByName(festivalId, names);
    setBulkBusy(false);
    if ("error" in r) { alert(r.error); return; }
    setBulkResult({ matched: r.matched, unmatched: r.unmatched });
    setUnmatched(r.unmatched);
    setBulkText("");
    // Refresh the visible "linked venues" grid with the freshly-fetched list
    // so the matched ones show up right away.
    onReplaceAll(r.venues);
  }

  // Called after an unmatched name has been resolved (matched to existing or
  // a new venue created). Drops it from the unmatched list and tells the
  // parent to re-render.
  function resolveUnmatched(name: string, newVenue?: FestivalVenueRow) {
    setUnmatched((prev) => prev.filter((n) => n !== name));
    if (newVenue) onAdd(newVenue);
  }

  return (
    <section className="card p-5 flex flex-col gap-4">
      <div>
        <h2 className="h-display text-xl">Venues</h2>
        <p className="text-xs text-buzz-mute mt-1">{venues.length} venue{venues.length === 1 ? "" : "s"} linked to this festival.</p>
      </div>

      {/* Currently assigned */}
      {venues.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {venues.map((v) => (
            <div key={v.id} className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg border border-buzz-border bg-buzz-surface text-sm">
              <div className="min-w-0">
                <div className="font-medium truncate">{v.name}</div>
                <div className="text-[10px] text-buzz-mute">{v.city ?? "—"}{!v.approved && " · pending"}</div>
              </div>
              <button type="button" onClick={() => remove(v.id)} className="text-xs text-rose-400 hover:text-rose-300">Remove</button>
            </div>
          ))}
        </div>
      )}

      {/* Search-and-add */}
      <div>
        <label className="label">Add a venue</label>
        <input
          className="input"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by name…"
        />
        {query.length > 0 && results.length > 0 && (
          <div className="mt-2 rounded-lg bg-buzz-card border border-buzz-border overflow-hidden">
            {results.map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={() => add(r)}
                disabled={r.alreadyAssigned}
                className="w-full text-left px-3 py-2 text-sm hover:bg-buzz-surface disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-between"
              >
                <span>
                  <span className="font-medium">{r.name}</span>
                  <span className="text-xs text-buzz-mute ml-2">{r.city ?? "—"}</span>
                </span>
                {r.alreadyAssigned && <span className="text-xs text-buzz-accent">already added</span>}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Bulk paste */}
      <details className="border border-buzz-border rounded-lg p-3">
        <summary className="cursor-pointer text-sm font-medium">⚡ Bulk add from name list</summary>
        <p className="text-xs text-buzz-mute mt-2 mb-2">
          Paste venue names, one per line. Each gets fuzzy-matched against existing venues (drops "the " prefix and " bar/pub" suffix). Unmatched names are reported back so you can create those venues separately.
        </p>
        <textarea
          className="input min-h-[120px] font-mono text-sm"
          value={bulkText}
          onChange={(e) => setBulkText(e.target.value)}
          placeholder={`Fat Sam's Live\nThe Anchor\nDukes Corner\nBruach`}
          disabled={bulkBusy}
        />
        <div className="flex justify-end mt-2">
          <button type="button" onClick={runBulk} disabled={bulkBusy || bulkText.trim().length === 0} className="btn-secondary text-xs">
            {bulkBusy ? "Matching…" : "Match & add"}
          </button>
        </div>
        {bulkResult && bulkResult.matched.length > 0 && (
          <div className="mt-3 text-xs">
            <div className="text-emerald-400 font-bold mb-1">✓ Matched ({bulkResult.matched.length})</div>
            <ul className="text-buzz-mute pl-4 list-disc">
              {bulkResult.matched.map((m, i) => <li key={i}>{m.input} → {m.venueName}</li>)}
            </ul>
          </div>
        )}
      </details>

      {/* Unmatched-venue work queue — shown until every entry is resolved */}
      {unmatched.length > 0 && (
        <div className="border border-rose-500/30 rounded-lg p-4 bg-rose-500/5 flex flex-col gap-3">
          <div>
            <h3 className="font-bold text-sm text-rose-300">
              Needs sorting ({unmatched.length})
            </h3>
            <p className="text-xs text-buzz-mute mt-1">
              These names didn't fuzzy-match any existing venue. Search again to double-check, or create a new venue with whatever info you have. Each gets linked to the festival once resolved.
            </p>
          </div>
          {unmatched.map((name) => (
            <UnmatchedVenueCard
              key={name}
              festivalId={festivalId}
              name={name}
              onResolved={(v) => resolveUnmatched(name, v)}
              onSkip={() => setUnmatched((prev) => prev.filter((n) => n !== name))}
            />
          ))}
        </div>
      )}
    </section>
  );
}

// Preview link card — a private URL that lets a third party view an
// unpublished festival page. Used to send sneak-peek links to prospective
// festival organisers ("here's what your page would look like").
function PreviewLinkCard({ festival }: { festival: FestivalRow }) {
  const [token, setToken] = useState(festival.preview_token ?? "");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const previewUrl = token ? `${origin}/festivals/${festival.slug}?preview=${token}` : "";

  async function regen() {
    if (!confirm("Regenerate the preview token? Any previously-shared links will stop working.")) return;
    setBusy(true);
    const r = await regenerateFestivalPreviewToken(festival.id);
    setBusy(false);
    if ("error" in r) {
      alert(r.error);
      return;
    }
    setToken(r.token);
  }

  async function copy() {
    if (!previewUrl) return;
    try {
      await navigator.clipboard.writeText(previewUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      alert("Couldn't copy automatically — select the URL above and Ctrl+C.");
    }
  }

  return (
    <section className="card p-5 flex flex-col gap-3 border-amber-500/40 bg-amber-500/5">
      <div>
        <h2 className="h-display text-xl">🔒 Private preview link</h2>
        <p className="text-xs text-buzz-mute mt-1">
          Send this URL to anyone you want to give a sneak peek of the festival page —
          works even when the festival is unpublished. Once you tick <strong>Published</strong> above,
          the regular URL works for everyone.
        </p>
      </div>

      {previewUrl ? (
        <>
          <div className="flex items-center gap-2">
            <input
              type="text"
              readOnly
              value={previewUrl}
              onFocus={(e) => e.currentTarget.select()}
              className="input flex-1 font-mono text-xs"
            />
            <button type="button" onClick={copy} className="btn-primary text-xs whitespace-nowrap">
              {copied ? "✓ Copied" : "Copy"}
            </button>
            <a
              href={previewUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="btn-secondary text-xs whitespace-nowrap"
            >
              Open ↗
            </a>
          </div>
          <button
            type="button"
            onClick={regen}
            disabled={busy}
            className="text-xs text-buzz-mute hover:text-rose-300 self-start"
          >
            {busy ? "Regenerating…" : "Regenerate token (invalidates old link)"}
          </button>
        </>
      ) : (
        <button type="button" onClick={regen} disabled={busy} className="btn-secondary self-start">
          {busy ? "Generating…" : "Generate preview token"}
        </button>
      )}
    </section>
  );
}

// Hero image picker — uploads to Supabase Storage and writes the public URL.
// Goes behind the festival landing hero (with a dark overlay) and is also the
// OG image for social shares.
function HeroImageUpload({
  festivalId,
  value,
  onChange,
  variant = "hero",
}: {
  festivalId: string;
  value: string;
  onChange: (url: string) => void;
  // "hero" = wide 16:6 banner; "logo" = square brand mark with
  // contain-fit so transparent logos sit nicely; "map" = the illustrated
  // site map shown on the festival page's Map tab (contain-fit, 4:3 box
  // since most festival site maps are roughly landscape).
  variant?: "hero" | "logo" | "map";
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isLogo = variant === "logo";
  const isMap = variant === "map";
  const aspectClass = isLogo
    ? "aspect-square max-w-[240px]"
    : isMap
      ? "aspect-[4/3]"
      : "aspect-[16/6]";
  const bgSize = isLogo || isMap ? "contain" : "cover";
  const emptyLabel = isLogo
    ? "Upload logo"
    : isMap
      ? "Upload site map"
      : "Upload hero image";
  const emptyHint = isLogo
    ? "Square / transparent PNG works best"
    : isMap
      ? "Wide illustrated map · PNG or JPEG"
      : "Wide / 16:9 works best";

  async function handleFile(file: File) {
    setError(null);
    if (!file.type.startsWith("image/")) {
      setError("That doesn't look like an image.");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setError("Image is over 10 MB.");
      return;
    }
    setBusy(true);
    try {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setError("Not signed in.");
        return;
      }
      const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
      const path = `festivals/${festivalId}/${variant}-${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from("media")
        .upload(path, file, { upsert: true, contentType: file.type || "image/jpeg" });
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
      {value ? (
        <div className="relative">
          <div
            className={`w-full ${aspectClass} rounded-lg bg-buzz-surface border border-buzz-border`}
            style={{
              backgroundImage: `url(${value})`,
              backgroundSize: bgSize,
              backgroundPosition: "center",
              backgroundRepeat: "no-repeat",
            }}
          />
          <div className="absolute top-2 right-2 flex gap-2">
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={busy}
              className="text-[11px] bg-black/70 backdrop-blur text-white px-2 py-1 rounded hover:bg-black/90"
            >
              Replace
            </button>
            <button
              type="button"
              onClick={() => onChange("")}
              className="text-[11px] bg-black/70 backdrop-blur text-rose-300 px-2 py-1 rounded hover:bg-black/90"
            >
              Remove
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={busy}
          className={`w-full ${aspectClass} rounded-lg border-2 border-dashed border-buzz-border bg-buzz-surface/50 hover:bg-buzz-surface text-buzz-mute hover:text-buzz-text transition flex flex-col items-center justify-center gap-2`}
        >
          <span className="text-3xl">📸</span>
          <span className="text-sm font-medium">{busy ? "Uploading…" : emptyLabel}</span>
          <span className="text-[10px] uppercase tracking-wider">{emptyHint}</span>
        </button>
      )}
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
      {error && <div className="text-xs text-rose-400">{error}</div>}
      {!isLogo && !isMap && (
        <p className="text-[11px] text-buzz-mute">
          Sits behind the festival hero with a dark overlay. Also used as the share preview image.
        </p>
      )}
    </div>
  );
}

// Per-unmatched-name workflow: search existing venues, or create new with
// optional auto-fill (postcode → lat/lng, FB URL kicks off cover-photo cron).
function UnmatchedVenueCard({
  festivalId,
  name,
  onResolved,
  onSkip,
}: {
  festivalId: string;
  name: string;
  onResolved: (v: FestivalVenueRow) => void;
  onSkip: () => void;
}) {
  const [mode, setMode] = useState<"idle" | "search" | "create">("idle");
  const [searchTerm, setSearchTerm] = useState(name);
  const [searchResults, setSearchResults] = useState<VenueSearchResult[] | null>(null);
  const [searchBusy, setSearchBusy] = useState(false);
  const [createBusy, setCreateBusy] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [createForm, setCreateForm] = useState({
    name,
    facebookUrl: "",
    website: "",
    address: "",
    postcode: "",
  });

  async function doSearch(term?: string) {
    const q = (term ?? searchTerm).trim();
    if (!q) return;
    setMode("search");
    setSearchBusy(true);
    const r = await searchExistingVenuesForName(festivalId, q);
    setSearchBusy(false);
    setSearchResults(r);
  }

  async function pickExisting(v: VenueSearchResult) {
    if (v.alreadyAssigned) {
      // Already linked — just clear it from the unmatched list
      onResolved({ id: v.id, name: v.name, slug: v.slug, city: v.city, approved: v.approved, sort_order: 0 });
      return;
    }
    const r = await addVenueToFestival(festivalId, v.id);
    if ("error" in r) { alert(r.error); return; }
    onResolved({ id: v.id, name: v.name, slug: v.slug, city: v.city, approved: v.approved, sort_order: 0 });
  }

  async function doCreate() {
    if (!createForm.name.trim()) { setCreateError("Name is required."); return; }
    setCreateBusy(true);
    setCreateError(null);
    const r = await createVenueAndLinkToFestival({
      festivalId,
      name: createForm.name,
      facebookUrl: createForm.facebookUrl || null,
      website: createForm.website || null,
      address: createForm.address || null,
      postcode: createForm.postcode || null,
    });
    setCreateBusy(false);
    if ("error" in r) { setCreateError(r.error); return; }
    onResolved({
      id: r.venueId,
      name: createForm.name,
      slug: r.venueSlug,
      city: "Dundee",
      approved: true,
      sort_order: 0,
    });
  }

  return (
    <div className="rounded-lg border border-buzz-border bg-buzz-card p-3 flex flex-col gap-2 text-sm">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="font-medium">{name}</div>
        <div className="flex gap-2 text-xs">
          {mode !== "search" && (
            <button type="button" onClick={() => doSearch()} className="btn-secondary text-xs py-1">
              🔍 Search existing
            </button>
          )}
          {mode !== "create" && (
            <button type="button" onClick={() => setMode("create")} className="btn-primary text-xs py-1">
              + Create new
            </button>
          )}
          <button type="button" onClick={onSkip} className="text-buzz-mute hover:text-buzz-text text-xs">
            Skip
          </button>
        </div>
      </div>

      {/* Search results */}
      {mode === "search" && (
        <div className="flex flex-col gap-2 mt-1">
          {/* Editable search term — try variations like dropping/adding words */}
          <div className="flex gap-2">
            <input
              type="text"
              className="input text-sm flex-1"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); doSearch(); } }}
              placeholder="Try a different spelling…"
            />
            <button
              type="button"
              onClick={() => doSearch()}
              disabled={searchBusy || !searchTerm.trim()}
              className="btn-secondary text-xs py-1"
            >
              {searchBusy ? "…" : "Search"}
            </button>
          </div>
          {searchBusy && <div className="text-xs text-buzz-mute">Searching for "{searchTerm}"…</div>}
          {!searchBusy && searchResults && searchResults.length === 0 && (
            <div className="text-xs text-buzz-mute">
              No matches for "{searchTerm}". Try a different spelling above, or click <strong>+ Create new</strong>.
            </div>
          )}
          {!searchBusy && searchResults && searchResults.length > 0 && (
            <>
              <div className="text-[11px] text-buzz-mute">Pick the right one (or refine the search above):</div>
              {searchResults.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => pickExisting(r)}
                  className="w-full text-left px-3 py-2 rounded-md bg-buzz-surface hover:bg-buzz-bg border border-buzz-border text-xs flex items-center justify-between gap-2"
                >
                  <span>
                    <span className="font-medium">{r.name}</span>
                    <span className="text-buzz-mute ml-2">{r.city ?? "—"}</span>
                    {!r.approved && <span className="text-buzz-accent ml-2">pending</span>}
                  </span>
                  {r.alreadyAssigned ? (
                    <span className="text-emerald-400 text-[10px]">already in festival — confirm</span>
                  ) : (
                    <span className="text-buzz-accent text-[10px]">+ link</span>
                  )}
                </button>
              ))}
            </>
          )}
        </div>
      )}

      {/* Create form */}
      {mode === "create" && (
        <div className="flex flex-col gap-2 mt-1 p-2 rounded-md bg-buzz-surface border border-buzz-border">
          <div>
            <label className="text-[10px] uppercase text-buzz-mute font-bold tracking-wider">Name</label>
            <input className="input text-sm" value={createForm.name} onChange={(e) => setCreateForm({ ...createForm, name: e.target.value })} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[10px] uppercase text-buzz-mute font-bold tracking-wider">Postcode (optional)</label>
              <input className="input text-sm" placeholder="DD1 1XX" value={createForm.postcode} onChange={(e) => setCreateForm({ ...createForm, postcode: e.target.value })} />
            </div>
            <div>
              <label className="text-[10px] uppercase text-buzz-mute font-bold tracking-wider">Address (optional)</label>
              <input className="input text-sm" value={createForm.address} onChange={(e) => setCreateForm({ ...createForm, address: e.target.value })} />
            </div>
          </div>
          <div>
            <label className="text-[10px] uppercase text-buzz-mute font-bold tracking-wider">Facebook URL (optional — auto-pulls cover photo)</label>
            <input className="input text-sm" placeholder="https://facebook.com/..." value={createForm.facebookUrl} onChange={(e) => setCreateForm({ ...createForm, facebookUrl: e.target.value })} />
          </div>
          <div>
            <label className="text-[10px] uppercase text-buzz-mute font-bold tracking-wider">Website (optional)</label>
            <input className="input text-sm" placeholder="https://..." value={createForm.website} onChange={(e) => setCreateForm({ ...createForm, website: e.target.value })} />
          </div>
          {createError && <div className="text-xs text-rose-400">{createError}</div>}
          <div className="flex gap-2 justify-end">
            <button type="button" onClick={() => setMode("idle")} disabled={createBusy} className="text-xs text-buzz-mute hover:text-buzz-text">
              Cancel
            </button>
            <button type="button" onClick={doCreate} disabled={createBusy} className="btn-primary text-xs py-1">
              {createBusy ? "Creating…" : "Create venue + link"}
            </button>
          </div>
          <p className="text-[10px] text-buzz-mute">
            Postcode → coordinates. FB URL → cover photo (next cron run). Address → admin can refine later. Approved + Dundee city by default.
          </p>
        </div>
      )}
    </div>
  );
}

// Click-and-drag focal-point picker. The 3×3 grid worked but pinned you
// to nine positions, which wasn't enough for landscape posters where
// the subject sits e.g. 70% of the way across. Now: click anywhere on
// the image to set the focal point, or click-and-drag the marker around.
//
// Output is a CSS `background-position` string in percentages
// ("45% 30%") — CSS handles both keyword and percentage forms, so any
// legacy "left top" / "center" values still work in the public render
// while being shown as percentages here for editing.
function HeroPositionPicker({
  imageUrl,
  value,
  opacity,
  blurPx,
  onChange,
}: {
  imageUrl: string;
  value: string;
  // Live-preview the opacity + blur sliders' current values so the admin
  // can tune position, transparency and blur together.
  opacity: number;
  blurPx: number;
  onChange: (position: string) => void;
}) {
  const { x, y } = parseBackgroundPositionToPercent(value);
  const [dragging, setDragging] = useState(false);
  const dragAreaRef = useRef<HTMLDivElement>(null);

  function pointToPercent(clientX: number, clientY: number) {
    const el = dragAreaRef.current;
    if (!el) return null;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return null;
    const px = Math.max(0, Math.min(100, ((clientX - r.left) / r.width) * 100));
    const py = Math.max(0, Math.min(100, ((clientY - r.top) / r.height) * 100));
    return { px: Math.round(px), py: Math.round(py) };
  }

  function commit(clientX: number, clientY: number) {
    const p = pointToPercent(clientX, clientY);
    if (!p) return;
    onChange(`${p.px}% ${p.py}%`);
  }

  // Pointer events instead of separate mouse/touch handlers so the same
  // code path works for desktop trackpads and touch-screens. Pointer
  // capture means the drag keeps tracking even when the cursor leaves
  // the image (otherwise dragging off the edge would silently stop).
  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    e.preventDefault();
    (e.target as Element).setPointerCapture?.(e.pointerId);
    setDragging(true);
    commit(e.clientX, e.clientY);
  }
  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!dragging) return;
    commit(e.clientX, e.clientY);
  }
  function onPointerUp(e: React.PointerEvent<HTMLDivElement>) {
    setDragging(false);
    (e.target as Element).releasePointerCapture?.(e.pointerId);
  }

  const positionString = `${x}% ${y}%`;

  return (
    <div className="mt-3 grid sm:grid-cols-2 gap-4">
      {/* Live preview at the same 16:6 ratio the public hero uses, with
          the admin's blur + opacity applied so they see roughly what
          visitors will see (minus the gradient scrim, which depends on
          the title text length — not worth simulating exactly). */}
      <div>
        <div className="text-[10px] uppercase tracking-wider text-buzz-mute mb-1">Preview</div>
        <div className="relative aspect-[16/6] rounded-lg border border-buzz-border bg-buzz-surface overflow-hidden">
          {/* Blurred backdrop layer — same treatment as the public page,
              including the blur-vs-scale relationship: heavy blur needs
              the up-scale to hide soft edges; near-zero blur doesn't. */}
          <div
            className="absolute inset-0"
            style={{
              backgroundImage: `url(${imageUrl})`,
              backgroundSize: "cover",
              backgroundPosition: positionString,
              filter: `blur(${blurPx}px) saturate(1.2)`,
              transform: blurPx >= 8 ? "scale(1.15)" : "scale(1.02)",
              opacity,
            }}
          />
          <div
            className="absolute inset-0"
            style={{
              background: "linear-gradient(180deg, rgba(10,10,15,0.55) 0%, rgba(10,10,15,0.85) 100%)",
            }}
          />
          <div className="absolute inset-0 flex items-center justify-center text-[10px] uppercase tracking-[0.25em] text-white/70">
            ← Hero preview →
          </div>
        </div>
        <p className="text-[11px] text-buzz-mute mt-1">
          Live preview with current opacity. Title text sits on top of this on the real page.
        </p>
      </div>

      {/* Drag area — full image with a focal-point marker the admin can
          drag around or click to place. Saves "x% y%" CSS values. */}
      <div>
        <div className="text-[10px] uppercase tracking-wider text-buzz-mute mb-1">
          Focal point — click or drag the dot
        </div>
        <div
          ref={dragAreaRef}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          className={
            "relative rounded-lg border border-buzz-border bg-buzz-surface select-none " +
            (dragging ? "cursor-grabbing" : "cursor-crosshair")
          }
          style={{ touchAction: "none" }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={imageUrl}
            alt=""
            className="block w-full h-auto rounded-lg pointer-events-none"
            draggable={false}
          />
          {/* Focal point marker — a target reticle centred on (x, y). */}
          <div
            className="absolute pointer-events-none"
            style={{
              left: `${x}%`,
              top: `${y}%`,
              transform: "translate(-50%, -50%)",
            }}
          >
            <div className="w-8 h-8 rounded-full border-2 border-white shadow-[0_0_0_2px_rgba(0,0,0,0.5)] bg-buzz-accent/40" />
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="w-1.5 h-1.5 rounded-full bg-white" />
            </div>
          </div>
        </div>
        <p className="text-[11px] text-buzz-mute mt-1">
          Position: <code>{positionString}</code>
        </p>
      </div>
    </div>
  );
}

// Opacity slider for the hero backdrop. Lives next to the position
// picker so admins tune the two together (position decides WHAT shows;
// opacity decides HOW LOUD it shows).
function HeroOpacitySlider({
  value,
  onChange,
}: {
  value: number;
  onChange: (v: number) => void;
}) {
  const pct = Math.round(value * 100);
  return (
    <div className="mt-3">
      <div className="flex items-center justify-between gap-3 mb-1">
        <label className="text-[10px] uppercase tracking-wider text-buzz-mute">
          Backdrop opacity
        </label>
        <span className="text-xs tabular-nums text-buzz-mute">{pct}%</span>
      </div>
      <input
        type="range"
        min={0}
        max={100}
        step={5}
        value={pct}
        onChange={(e) => onChange(Number(e.target.value) / 100)}
        className="w-full accent-buzz-accent"
      />
      <p className="text-[11px] text-buzz-mute mt-1">
        Lower = more muted backdrop (title reads cleaner over busy posters).
        Higher = more visible image, but watch the title contrast.
      </p>
    </div>
  );
}

// Blur slider for the hero backdrop. Independent of opacity — these
// two controls do different things:
//   • opacity = how strongly the image cuts through
//   • blur    = whether you see the image at all, or just a texture
// 0 = sharp cover photo (best for hi-res clean-background posters).
// ~24 = the old hard-coded heavy-blur look (best for busy posters
// where you want the title to dominate).
function HeroBlurSlider({
  value,
  onChange,
}: {
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="mt-3">
      <div className="flex items-center justify-between gap-3 mb-1">
        <label className="text-[10px] uppercase tracking-wider text-buzz-mute">
          Backdrop blur
        </label>
        <span className="text-xs tabular-nums text-buzz-mute">{value}px</span>
      </div>
      <input
        type="range"
        min={0}
        max={40}
        step={1}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-buzz-accent"
      />
      <p className="text-[11px] text-buzz-mute mt-1">
        <strong>0px</strong> = sharp cover photo · <strong>~12px</strong> = soft blur ·{" "}
        <strong>24px</strong> = heavy blur (the old default). Drop it to 0 if you
        want visitors to see the actual poster on the hero.
      </p>
    </div>
  );
}

// Parse a CSS `background-position` value into percentage coordinates.
// Handles keyword pairs ("left top", "center", "right bottom"), single
// keywords ("center", "top"), and explicit percentages ("45% 30%").
function parseBackgroundPositionToPercent(value: string | null | undefined): { x: number; y: number } {
  const v = (value ?? "center").trim().toLowerCase();
  if (!v) return { x: 50, y: 50 };
  // Explicit percentages — most common after a user touches the new picker
  const pctMatch = v.match(/^(\d+(?:\.\d+)?)\s*%\s+(\d+(?:\.\d+)?)\s*%$/);
  if (pctMatch) {
    return { x: clamp01(Number(pctMatch[1])), y: clamp01(Number(pctMatch[2])) };
  }
  // Keyword forms — map each to a percentage
  const keywordX: Record<string, number> = { left: 0, center: 50, centre: 50, right: 100 };
  const keywordY: Record<string, number> = { top: 0, center: 50, centre: 50, bottom: 100 };
  const parts = v.split(/\s+/);
  if (parts.length === 1) {
    // Single keyword can be either axis-specific or "center" for both
    const k = parts[0];
    if (k in keywordX && k in keywordY) return { x: keywordX[k], y: keywordY[k] };
    if (k in keywordX) return { x: keywordX[k], y: 50 };
    if (k in keywordY) return { x: 50, y: keywordY[k] };
  } else if (parts.length === 2) {
    // CSS allows either order ("top right" === "right top") — try both.
    const [a, b] = parts;
    const xa = keywordX[a]; const yb = keywordY[b];
    if (xa !== undefined && yb !== undefined) return { x: xa, y: yb };
    const ya = keywordY[a]; const xb = keywordX[b];
    if (ya !== undefined && xb !== undefined) return { x: xb, y: ya };
  }
  // Anything unrecognised → center, so the marker isn't off-screen
  return { x: 50, y: 50 };
}

function clamp01(n: number): number {
  if (Number.isNaN(n)) return 50;
  return Math.max(0, Math.min(100, n));
}
