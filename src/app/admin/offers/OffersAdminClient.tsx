"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createOffer, deleteOffer } from "./actions";

type Offer = {
  id: string; category: string; title: string; provider: string | null;
  terms: string | null; url: string | null; scope: string; city_id: string | null; approved: boolean;
  reports?: number;
};
type City = { id: string; name: string; slug: string };

export default function OffersAdminClient({ offers, cities }: { offers: Offer[]; cities: City[] }) {
  const router = useRouter();
  const [scope, setScope] = useState("national");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const form = e.currentTarget;
    const r = await createOffer(new FormData(form));
    setBusy(false);
    if (r.error) { setError(r.error); return; }
    form.reset();
    setScope("national");
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

  const food = offers.filter((o) => o.category === "food");
  const daysOut = offers.filter((o) => o.category === "days-out");

  const list = (items: Offer[], label: string) => (
    <div className="mb-6">
      <h2 className="font-display text-xl uppercase mb-2">{label} <span className="text-buzz-mute text-sm font-normal">({items.length})</span></h2>
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
              </div>
              <button onClick={() => destroy(o)} disabled={pending && busyId === o.id} className="btn-danger text-sm shrink-0">
                {pending && busyId === o.id ? "…" : "Delete"}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );

  return (
    <div>
      {/* Add form */}
      <form onSubmit={onSubmit} className="card p-6 grid sm:grid-cols-2 gap-4 mb-10">
        <h2 className="sm:col-span-2 font-display text-2xl uppercase">Add an offer</h2>
        <div>
          <label className="label">Type *</label>
          <select name="category" className="input" defaultValue="food">
            <option value="food">🍽️ Food (eating out)</option>
            <option value="days-out">🎟️ Days out</option>
          </select>
        </div>
        <div>
          <label className="label">Provider</label>
          <input name="provider" className="input" placeholder="e.g. Asda Café" maxLength={120} />
        </div>
        <div className="sm:col-span-2">
          <label className="label">Title *</label>
          <input name="title" className="input" required maxLength={160} placeholder="e.g. Kids eat for £1 at Asda Café" />
        </div>
        <div className="sm:col-span-2">
          <label className="label">Short description</label>
          <input name="description" className="input" maxLength={300} placeholder="One line on what the deal is." />
        </div>
        <div className="sm:col-span-2">
          <label className="label">Terms / small print</label>
          <textarea name="terms" className="input min-h-[80px]" maxLength={500} placeholder="Ages, days, minimum spend, branches etc." />
        </div>
        <div className="sm:col-span-2">
          <label className="label">Link</label>
          <input name="url" type="url" className="input" placeholder="https://…" />
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
            <select name="city_id" className="input" defaultValue="">
              <option value="" disabled>Pick an area…</option>
              {cities.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
        )}
        {error && <div className="sm:col-span-2 text-sm text-rose-400">{error}</div>}
        <div className="sm:col-span-2">
          <button type="submit" className="btn-primary" disabled={busy}>{busy ? "Adding…" : "Add offer"}</button>
        </div>
      </form>

      {list(food, "🍽️ Food deals")}
      {list(daysOut, "🎟️ Days out")}
    </div>
  );
}
