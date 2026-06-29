"use client";

import { useState } from "react";
import Link from "next/link";
import { submitOffer } from "@/lib/offers-actions";

type City = { name: string; slug: string };

export default function SubmitOfferForm({ cities }: { cities: City[] }) {
  const [scope, setScope] = useState("local");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const fd = new FormData(e.currentTarget);
    const r = await submitOffer({
      category: String(fd.get("category") ?? ""),
      title: String(fd.get("title") ?? ""),
      provider: String(fd.get("provider") ?? ""),
      description: String(fd.get("description") ?? ""),
      terms: String(fd.get("terms") ?? ""),
      url: String(fd.get("url") ?? ""),
      scope: String(fd.get("scope") ?? "local"),
      citySlug: String(fd.get("city_slug") ?? ""),
      email: String(fd.get("email") ?? ""),
    });
    setBusy(false);
    if (r.error) { setError(r.error); return; }
    setDone(true);
  }

  if (done) {
    return (
      <div className="card p-8 text-center">
        <div className="text-5xl mb-3">🙌</div>
        <h2 className="h-display text-3xl mb-2">Thanks!</h2>
        <p className="text-buzz-mute mb-4 max-w-md mx-auto">
          We've got your suggestion and we'll check it before it goes live. You're helping
          loads of local families save a few quid.
        </p>
        <Link href="/browse?tab=food" className="btn-secondary">See the deals</Link>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="card p-6 grid sm:grid-cols-2 gap-4">
      <div>
        <label className="label">Type of deal *</label>
        <select name="category" className="input" defaultValue="food">
          <option value="food">🍽️ Food (kids eat free / £1)</option>
          <option value="days-out">🎟️ Days out (cheap / free entry)</option>
        </select>
      </div>
      <div>
        <label className="label">Business name</label>
        <input name="provider" className="input" maxLength={120} placeholder="e.g. The Tailend" />
      </div>
      <div className="sm:col-span-2">
        <label className="label">What's the deal? *</label>
        <input name="title" className="input" required maxLength={160} placeholder="e.g. Kids eat free on Sundays" />
      </div>
      <div className="sm:col-span-2">
        <label className="label">Any details / small print</label>
        <textarea name="terms" className="input min-h-[90px]" maxLength={500} placeholder="Days, times, ages, minimum spend, which branch…" />
      </div>
      <div className="sm:col-span-2">
        <label className="label">Link (if you have one)</label>
        <input name="url" type="url" className="input" placeholder="https://…" />
      </div>
      <div>
        <label className="label">Where?</label>
        <select name="scope" value={scope} onChange={(e) => setScope(e.target.value)} className="input">
          <option value="local">A local place</option>
          <option value="national">UK-wide chain</option>
        </select>
      </div>
      {scope === "local" && (
        <div>
          <label className="label">Area</label>
          <select name="city_slug" className="input" defaultValue="">
            <option value="">Pick an area…</option>
            {cities.map((c) => <option key={c.slug} value={c.slug}>{c.name}</option>)}
          </select>
        </div>
      )}
      <input type="hidden" name="description" value="" />
      <div className="sm:col-span-2">
        <label className="label">Your email <span className="text-buzz-mute font-normal">(optional)</span></label>
        <input name="email" type="email" className="input" maxLength={200} placeholder="So we can check back if we need to" />
        <p className="help">We'll only use it to follow up on your suggestion — never shown publicly.</p>
      </div>

      {error && <div className="sm:col-span-2 text-sm text-rose-400">{error}</div>}
      <div className="sm:col-span-2 flex items-center gap-3 pt-1">
        <button type="submit" className="btn-primary" disabled={busy}>{busy ? "Sending…" : "Send it in"}</button>
        <span className="text-xs text-buzz-mute">We'll review before it appears.</span>
      </div>
    </form>
  );
}
