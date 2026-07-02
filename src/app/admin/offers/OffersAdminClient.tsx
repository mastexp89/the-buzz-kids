"use client";

import { useState, useTransition, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { createOffer, updateOffer, deleteOffer, approveOffer, searchOfferVenues, extractOfferFromImage } from "./actions";

type Offer = {
  id: string; category: string; title: string; provider: string | null;
  description?: string | null; terms: string | null; url: string | null;
  business_url?: string | null; image_url?: string | null;
  scope: string; city_id: string | null; venue_id?: string | null;
  venue?: { name: string | null } | null;
  approved: boolean;
  reports?: number; submitted_email?: string | null;
};
type City = { id: string; name: string; slug: string };

export default function OffersAdminClient({ offers, cities, canManage = true }: { offers: Offer[]; cities: City[]; canManage?: boolean }) {
  const router = useRouter();
  const [scope, setScope] = useState("national");
  const [cityId, setCityId] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyT, start] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);

  // Poster autofill + venue attach.
  const formRef = useRef<HTMLFormElement>(null);
  const categoryRef = useRef<HTMLSelectElement>(null);
  const providerRef = useRef<HTMLInputElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const descRef = useRef<HTMLInputElement>(null);
  const termsRef = useRef<HTMLTextAreaElement>(null);
  const urlRef = useRef<HTMLInputElement>(null);
  const businessUrlRef = useRef<HTMLInputElement>(null);
  const [imageUrl, setImageUrl] = useState("");
  const [extracting, setExtracting] = useState(false);
  const [venue, setVenue] = useState<{ id: string; name: string } | null>(null);
  const [vq, setVq] = useState("");
  const [vResults, setVResults] = useState<any[]>([]);

  useEffect(() => {
    if (vq.trim().length < 2 || venue) { setVResults([]); return; }
    const t = setTimeout(async () => { const r = await searchOfferVenues(vq); setVResults((r as any).results ?? []); }, 250);
    return () => clearTimeout(t);
  }, [vq, venue]);

  async function onPoster(file: File) {
    setError(null); setExtracting(true);
    const dataUrl: string = await new Promise((res) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.readAsDataURL(file); });
    const out = await extractOfferFromImage(dataUrl, file.name);
    setExtracting(false);
    if ((out as any).imageUrl) setImageUrl((out as any).imageUrl);
    if ((out as any).error) { setError((out as any).error); return; }
    const f = (out as any).fields || {};
    const set = (ref: React.RefObject<any>, v: string) => { if (ref.current && v) ref.current.value = v; };
    if (categoryRef.current && (f.category === "food" || f.category === "days-out")) categoryRef.current.value = f.category;
    set(providerRef, f.provider); set(titleRef, f.title); set(descRef, f.description); set(termsRef, f.terms); set(urlRef, f.url);
    if (f.scope === "local" || f.scope === "national") setScope(f.scope);
  }

  function resetForm() {
    formRef.current?.reset();
    setEditingId(null);
    setScope("national"); setCityId(""); setVenue(null); setVq(""); setImageUrl(""); setError(null);
  }

  function startEdit(o: Offer) {
    setEditingId(o.id);
    setError(null);
    if (categoryRef.current) categoryRef.current.value = o.category;
    if (providerRef.current) providerRef.current.value = o.provider ?? "";
    if (titleRef.current) titleRef.current.value = o.title ?? "";
    if (descRef.current) descRef.current.value = o.description ?? "";
    if (termsRef.current) termsRef.current.value = o.terms ?? "";
    if (urlRef.current) urlRef.current.value = o.url ?? "";
    if (businessUrlRef.current) businessUrlRef.current.value = o.business_url ?? "";
    setScope(o.scope === "local" ? "local" : "national");
    setCityId(o.city_id ?? "");
    setImageUrl(o.image_url ?? "");
    setVenue(o.venue_id ? { id: o.venue_id, name: o.venue?.name ?? "Attached place" } : null);
    setVq("");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const form = e.currentTarget;
    const r = editingId
      ? await updateOffer(editingId, new FormData(form))
      : await createOffer(new FormData(form));
    setBusy(false);
    if (r.error) { setError(r.error); return; }
    resetForm();
    router.refresh();
  }

  function destroy(o: Offer) {
    if (!confirm(`Delete "${o.title}"?`)) return;
    setBusyId(o.id);
    start(async () => {
      await deleteOffer(o.id);
      setBusyId(null);
      router.refresh();
    });
  }

  function approve(o: Offer) {
    setBusyId(o.id);
    start(async () => {
      await approveOffer(o.id);
      setBusyId(null);
      router.refresh();
    });
  }

  const pending = offers.filter((o) => !o.approved);
  const live = offers.filter((o) => o.approved);
  const food = live.filter((o) => o.category === "food");
  const daysOut = live.filter((o) => o.category === "days-out");

  const list = (items: Offer[], label: string) => (
    <div className={label ? "mb-6" : ""}>
      {label && (
        <h2 className="font-display text-xl uppercase mb-2">{label} <span className="text-buzz-mute text-sm font-normal">({items.length})</span></h2>
      )}
      {items.length === 0 ? (
        <div className="card p-5 text-buzz-mute text-sm">None yet.</div>
      ) : (
        <ul className="card divide-y divide-buzz-border/60">
          {items.map((o) => (
            <li key={o.id} className="p-4 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="font-medium flex items-center gap-2 flex-wrap">
                  {o.title}
                  {!o.approved && <span className="text-[10px] uppercase bg-amber-500/15 text-amber-600 px-1.5 py-0.5 rounded">hidden</span>}
                  {!!o.reports && o.reports > 0 && (
                    <span className="text-[10px] uppercase bg-rose-500/15 text-rose-500 px-1.5 py-0.5 rounded" title="Visitors flagged this as ended">
                      ⚠️ {o.reports} report{o.reports === 1 ? "" : "s"}
                    </span>
                  )}
                </div>
                <div className="text-xs text-buzz-mute">
                  {o.provider ?? ""}{o.scope === "local" ? " · Local" : " · UK-wide"}
                </div>
                {o.terms && <div className="text-xs text-buzz-mute/80 mt-0.5 line-clamp-1">{o.terms}</div>}
                {o.submitted_email && <div className="text-xs text-buzz-mute/80 mt-0.5">✉️ {o.submitted_email}</div>}
              </div>
              <div className="flex gap-2 shrink-0">
                {!o.approved && (
                  <button onClick={() => approve(o)} disabled={busyT && busyId === o.id} className="btn-primary text-sm">
                    {busyT && busyId === o.id ? "…" : "Approve"}
                  </button>
                )}
                <button onClick={() => startEdit(o)} className="btn-secondary text-sm">Edit</button>
                <button onClick={() => destroy(o)} disabled={busyT && busyId === o.id} className="btn-danger text-sm">
                  {busyT && busyId === o.id ? "…" : "Delete"}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );

  return (
    <div>
      {/* Add / edit form */}
      <form ref={formRef} onSubmit={onSubmit} className="card p-6 grid sm:grid-cols-2 gap-4 mb-10">
        <h2 className="sm:col-span-2 font-display text-2xl uppercase">{editingId ? "Edit offer" : "Add an offer"}</h2>

        {/* Poster autofill + image / logo override */}
        <div className="sm:col-span-2 rounded-xl border border-buzz-accent/30 bg-buzz-accent/5 p-3">
          <label className="label !mb-1">📸 Poster or logo</label>
          <p className="help !mt-0 mb-2">
            Upload a poster (AI fills the form), or paste an image/logo URL below. Any image here
            <strong className="text-buzz-text"> overrides the auto brand logo</strong> on the card —
            clear it to go back to the auto logo.
          </p>
          <input type="file" accept="image/*" onChange={(e) => { const f = e.target.files?.[0]; if (f) onPoster(f); }} className="text-sm" />
          {extracting && <span className="text-xs text-buzz-accent ml-2">Reading the poster…</span>}
          <div className="flex items-center gap-2 mt-2">
            <input
              type="url"
              name="image_url"
              value={imageUrl}
              onChange={(e) => setImageUrl(e.target.value)}
              placeholder="…or paste an image / logo URL"
              className="input text-sm flex-1"
            />
            {imageUrl && (
              <button type="button" onClick={() => setImageUrl("")} className="btn-secondary text-sm shrink-0">Clear</button>
            )}
          </div>
          {imageUrl && <img src={imageUrl} alt="" className="mt-2 h-24 rounded-lg border border-buzz-border object-contain bg-buzz-surface" />}
        </div>

        {/* Attach to a place */}
        <div className="sm:col-span-2 relative">
          <label className="label">Attach to a place <span className="text-buzz-mute font-normal">(optional)</span></label>
          {venue ? (
            <div className="flex items-center gap-2">
              <span className="input flex-1 flex items-center">📍 {venue.name}</span>
              <button type="button" onClick={() => { setVenue(null); setVq(""); }} className="btn-secondary text-sm">Change</button>
            </div>
          ) : (
            <>
              <input value={vq} onChange={(e) => setVq(e.target.value)} placeholder="Search your places by name…" className="input" autoComplete="off" />
              {vResults.length > 0 && (
                <ul className="absolute z-20 mt-1 w-full rounded-lg border border-buzz-border bg-buzz-card shadow-xl max-h-56 overflow-y-auto">
                  {vResults.map((v) => (
                    <li key={v.id}>
                      <button type="button" onClick={() => { setVenue({ id: v.id, name: v.name }); setVResults([]); }} className="w-full text-left px-3 py-2 text-sm hover:bg-buzz-surface">
                        {v.name} <span className="text-buzz-mute text-xs">· {v.city?.name ?? "—"}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>
        <input type="hidden" name="venue_id" value={venue?.id ?? ""} />

        <div>
          <label className="label">Type *</label>
          <select ref={categoryRef} name="category" className="input" defaultValue="food">
            <option value="food">🍽️ Food (eating out)</option>
            <option value="days-out">🎟️ Days out</option>
          </select>
        </div>
        <div>
          <label className="label">Provider</label>
          <input ref={providerRef} name="provider" className="input" placeholder="e.g. Asda Café" maxLength={120} />
        </div>
        <div className="sm:col-span-2">
          <label className="label">Title *</label>
          <input ref={titleRef} name="title" className="input" required maxLength={160} placeholder="e.g. Kids eat for £1 at Asda Café" />
        </div>
        <div className="sm:col-span-2">
          <label className="label">Short description</label>
          <input ref={descRef} name="description" className="input" maxLength={300} placeholder="One line on what the deal is." />
        </div>
        <div className="sm:col-span-2">
          <label className="label">Terms / small print</label>
          <textarea ref={termsRef} name="terms" className="input min-h-[80px]" maxLength={500} placeholder="Ages, days, minimum spend, branches etc." />
        </div>
        <div>
          <label className="label">Offer link <span className="text-buzz-mute font-normal">(where the deal is)</span></label>
          <input ref={urlRef} name="url" type="url" className="input" placeholder="https://…/offers" />
        </div>
        <div>
          <label className="label">Business website</label>
          <input ref={businessUrlRef} name="business_url" type="url" className="input" placeholder="https://…" />
        </div>
        <div>
          <label className="label">Scope</label>
          <select name="scope" value={scope} onChange={(e) => setScope(e.target.value)} className="input">
            <option value="national">UK-wide</option>
            <option value="local">Local (one area)</option>
          </select>
        </div>
        {scope === "local" && (
          <div>
            <label className="label">Area</label>
            <select name="city_id" className="input" value={cityId} onChange={(e) => setCityId(e.target.value)}>
              <option value="" disabled>Pick an area…</option>
              {cities.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
        )}
        {error && <div className="sm:col-span-2 text-sm text-rose-400">{error}</div>}
        <div className="sm:col-span-2 flex items-center gap-2">
          <button type="submit" className="btn-primary" disabled={busy}>
            {busy ? (editingId ? "Saving…" : "Adding…") : (editingId ? "Save changes" : "Add offer")}
          </button>
          {editingId && (
            <button type="button" onClick={resetForm} className="btn-secondary" disabled={busy}>Cancel</button>
          )}
        </div>
      </form>

      {!canManage && (
        <p className="text-sm text-buzz-mute">
          Your deal goes live straight away. Thanks for helping families save a few quid!
        </p>
      )}

      {canManage && pending.length > 0 && (
        <div className="mb-8">
          <div className="card p-1 border-buzz-accent/50">
            <div className="px-4 pt-3 pb-1">
              <h2 className="font-display text-xl uppercase text-buzz-accent">
                🙌 Suggested by visitors <span className="text-buzz-mute text-sm font-normal">({pending.length})</span>
              </h2>
              <p className="text-xs text-buzz-mute">Approve to publish, or delete if it's not right.</p>
            </div>
            {list(pending, "")}
          </div>
        </div>
      )}

      {canManage && list(food, "🍽️ Food deals")}
      {canManage && list(daysOut, "🎟️ Days out")}
    </div>
  );
}
