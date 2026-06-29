"use client";

import { useState } from "react";
import Link from "next/link";
import { extractPastedEvent, publishPastedEvents, searchVenuesForPaste, type PasteDraft } from "./actions";

type City = { id: string; name: string };
type Genre = { slug: string; name: string };

// ISO instant → "YYYY-MM-DDTHH:mm" in UK local time, for datetime-local inputs.
function isoToLocal(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const p = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(d);
  const g = (t: string) => p.find((x) => x.type === t)!.value;
  return `${g("year")}-${g("month")}-${g("day")}T${g("hour") === "24" ? "00" : g("hour")}:${g("minute")}`;
}

type EditDraft = {
  title: string; startLocal: string; endLocal: string; end_date: string;
  description: string; categories: string[]; age_min: number | null; age_max: number | null;
  cover_charge: string; is_free: boolean; price_from: number | null; booking_required: boolean;
  setting: "indoor" | "outdoor" | "both" | null; accessibility: string[]; confidence: number; venue_hint: string | null;
};

function toEdit(d: PasteDraft): EditDraft {
  return {
    title: d.title, startLocal: isoToLocal(d.starts_at), endLocal: isoToLocal(d.ends_at), end_date: d.end_date ?? "",
    description: d.description, categories: d.categories, age_min: d.age_min, age_max: d.age_max,
    cover_charge: d.cover_charge ?? "", is_free: d.is_free, price_from: d.price_from, booking_required: d.booking_required,
    setting: d.setting, accessibility: d.accessibility, confidence: d.confidence, venue_hint: d.venue_hint,
  };
}

export default function PasteEventClient({ cities, genres }: { cities: City[]; genres: Genre[] }) {
  const genreName = (slug: string) => genres.find((g) => g.slug === slug)?.name ?? slug;

  const [step, setStep] = useState<"input" | "review" | "done">("input");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [text, setText] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [cityId, setCityId] = useState("");

  const [drafts, setDrafts] = useState<EditDraft[]>([]);
  const [venueId, setVenueId] = useState<string | null>(null);
  const [whereText, setWhereText] = useState("");
  const [venueMatches, setVenueMatches] = useState<{ id: string; name: string; city: string | null }[]>([]);
  const [publishedCount, setPublishedCount] = useState(0);

  async function onExtract() {
    setError(null);
    if (!cityId) { setError("Pick an area first."); return; }
    if (!text.trim() && !imageUrl.trim()) { setError("Paste the post text (or add an image URL)."); return; }
    setBusy(true);
    const r = await extractPastedEvent({ text, imageUrl, cityId });
    setBusy(false);
    if ("error" in r) { setError(r.error); return; }
    setDrafts(r.drafts.map(toEdit));
    setWhereText(r.drafts[0]?.venue_hint ?? "");
    setStep("review");
  }

  function setDraft(i: number, patch: Partial<EditDraft>) {
    setDrafts((ds) => ds.map((d, idx) => (idx === i ? { ...d, ...patch } : d)));
  }

  async function onWhereSearch(q: string) {
    setWhereText(q);
    setVenueId(null);
    if (q.trim().length < 2) { setVenueMatches([]); return; }
    setVenueMatches(await searchVenuesForPaste(q));
  }

  async function onPublish() {
    setError(null);
    if (!venueId && !whereText.trim()) { setError("Attach a place or type where it's happening."); return; }
    setBusy(true);
    const r = await publishPastedEvents({
      cityId, venueId, locationName: venueId ? null : whereText.trim(),
      imageUrl: imageUrl.trim() || null, sourceUrl: sourceUrl.trim() || null,
      drafts: drafts.map((d) => ({
        title: d.title, startLocal: d.startLocal, endLocal: d.endLocal || null, end_date: d.end_date || null,
        description: d.description, categories: d.categories, age_min: d.age_min, age_max: d.age_max,
        cover_charge: d.cover_charge || null, is_free: d.is_free, price_from: d.price_from,
        booking_required: d.booking_required, setting: d.setting, accessibility: d.accessibility,
      })),
    });
    setBusy(false);
    if ("error" in r) { setError(r.error); return; }
    setPublishedCount(r.published);
    setStep("done");
  }

  function reset() {
    setText(""); setImageUrl(""); setSourceUrl(""); setDrafts([]); setVenueId(null); setWhereText(""); setVenueMatches([]); setError(null); setStep("input");
  }

  if (step === "done") {
    return (
      <div className="card p-6 text-center">
        <div className="text-5xl mb-3">🎉</div>
        <h2 className="h-display text-3xl mb-2">{publishedCount} event{publishedCount === 1 ? "" : "s"} published</h2>
        <p className="text-buzz-mute mb-5">They&apos;re live now.</p>
        <div className="flex gap-3 justify-center flex-wrap">
          <button onClick={reset} className="btn-primary">Paste another</button>
          <Link href="/admin/events-manage" className="btn-secondary">Manage events</Link>
        </div>
      </div>
    );
  }

  if (step === "input") {
    return (
      <div className="card p-6 flex flex-col gap-4">
        <div>
          <label className="label">Area *</label>
          <select className="input" value={cityId} onChange={(e) => setCityId(e.target.value)}>
            <option value="">Choose an area…</option>
            {cities.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div>
          <label className="label">Paste the post *</label>
          <textarea className="input min-h-[180px]" value={text} onChange={(e) => setText(e.target.value)}
            placeholder="Paste the full Facebook post here — title, date, time, price, age, where it is…" />
        </div>
        <div>
          <label className="label">Poster image URL (optional)</label>
          <input className="input" value={imageUrl} onChange={(e) => setImageUrl(e.target.value)} placeholder="https://… (right-click the poster → Copy image address)" />
        </div>
        <div>
          <label className="label">Link to the post (optional)</label>
          <input className="input" value={sourceUrl} onChange={(e) => setSourceUrl(e.target.value)} placeholder="https://facebook.com/…" />
          <p className="help">Stored as the event&apos;s &quot;more info&quot; link.</p>
        </div>
        {error && <div className="text-sm text-rose-400">{error}</div>}
        <button onClick={onExtract} disabled={busy} className="btn-primary">{busy ? "Reading the post…" : "✨ Extract event"}</button>
      </div>
    );
  }

  // review
  return (
    <div className="flex flex-col gap-5">
      <div className="card p-5">
        <label className="label">Where is it? *</label>
        <input className="input" value={whereText} onChange={(e) => onWhereSearch(e.target.value)}
          placeholder="Type a place name to attach it, or just a location" />
        {venueId && <p className="text-xs text-buzz-good mt-1">✓ Attached to an existing place.</p>}
        {!venueId && venueMatches.length > 0 && (
          <div className="mt-2 flex flex-col gap-1">
            {venueMatches.map((v) => (
              <button key={v.id} onClick={() => { setVenueId(v.id); setWhereText(v.name); setVenueMatches([]); }}
                className="text-left text-sm px-3 py-2 rounded-lg bg-buzz-surface hover:bg-buzz-card transition">
                {v.name}{v.city ? <span className="text-buzz-mute"> · {v.city}</span> : null}
              </button>
            ))}
          </div>
        )}
        {!venueId && whereText.trim() && <p className="help mt-1">Not in the list? It&apos;ll be saved as a location label (no place page).</p>}
      </div>

      {drafts.map((d, i) => (
        <div key={i} className="card p-5 flex flex-col gap-3">
          <div className="flex items-center justify-between gap-2">
            <span className="label">Event {drafts.length > 1 ? i + 1 : ""}</span>
            <span className="text-xs text-buzz-mute">confidence {Math.round((d.confidence ?? 0) * 100)}%</span>
          </div>
          <div>
            <label className="label">Title</label>
            <input className="input" value={d.title} onChange={(e) => setDraft(i, { title: e.target.value })} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="label">Starts</label><input type="datetime-local" className="input" value={d.startLocal} onChange={(e) => setDraft(i, { startLocal: e.target.value })} /></div>
            <div><label className="label">Ends (optional)</label><input type="datetime-local" className="input" value={d.endLocal} onChange={(e) => setDraft(i, { endLocal: e.target.value })} /></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="label">Runs until (multi-day, optional)</label><input type="date" className="input" value={d.end_date} onChange={(e) => setDraft(i, { end_date: e.target.value })} /></div>
            <div><label className="label">Indoor / outdoor</label>
              <select className="input" value={d.setting ?? ""} onChange={(e) => setDraft(i, { setting: (e.target.value || null) as any })}>
                <option value="">—</option><option value="indoor">Indoor</option><option value="outdoor">Outdoor</option><option value="both">Both</option>
              </select>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div><label className="label">Age from</label><input type="number" min={0} className="input" value={d.age_min ?? ""} onChange={(e) => setDraft(i, { age_min: e.target.value === "" ? null : Number(e.target.value) })} /></div>
            <div><label className="label">Age to</label><input type="number" min={0} className="input" value={d.age_max ?? ""} onChange={(e) => setDraft(i, { age_max: e.target.value === "" ? null : Number(e.target.value) })} /></div>
            <div>
              <label className="label">Price</label>
              <input className="input" value={d.is_free ? "" : d.cover_charge} disabled={d.is_free} placeholder={d.is_free ? "Free" : "£4"} onChange={(e) => setDraft(i, { cover_charge: e.target.value })} />
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={d.is_free} onChange={(e) => setDraft(i, { is_free: e.target.checked })} /> Free to attend
          </label>
          <div>
            <label className="label">Description</label>
            <textarea className="input min-h-[80px]" value={d.description} onChange={(e) => setDraft(i, { description: e.target.value })} />
          </div>
          {d.categories.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {d.categories.map((slug) => (
                <button key={slug} onClick={() => setDraft(i, { categories: d.categories.filter((s) => s !== slug) })}
                  className="chip text-xs" title="Remove">{genreName(slug)} ✕</button>
              ))}
            </div>
          )}
          {drafts.length > 1 && (
            <button onClick={() => setDrafts((ds) => ds.filter((_, idx) => idx !== i))} className="text-xs text-rose-400 self-start hover:underline">Remove this event</button>
          )}
        </div>
      ))}

      {error && <div className="text-sm text-rose-400">{error}</div>}
      <div className="flex gap-3 flex-wrap">
        <button onClick={onPublish} disabled={busy || drafts.length === 0} className="btn-primary">{busy ? "Publishing…" : `Publish ${drafts.length} event${drafts.length === 1 ? "" : "s"}`}</button>
        <button onClick={reset} className="btn-secondary" disabled={busy}>Start over</button>
      </div>
    </div>
  );
}
