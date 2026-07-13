"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import OfferReportButton from "@/components/OfferReportButton";
import AdminDeleteButton from "@/components/AdminDeleteButton";

// Show this many offers first; the rest sit behind a "show more" button so the
// Deals / Food tabs load light and don't dump everything at once.
const INITIAL_CAP = 24;
const REGION_KEY = "buzzkids_deals_region";

type Offer = {
  id: string;
  category: string;
  title: string;
  provider: string | null;
  description: string | null;
  terms: string | null;
  url: string | null;
  business_url?: string | null;
  image_url?: string | null;
  ends_on?: string | null;
  scope: string;
  city_id?: string | null;
};

type City = { id: string; name: string; slug: string };

// Trim to a tidy host label for the "visit website" link.
function host(u: string): string {
  try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return "website"; }
}

export default function OffersView({
  offers,
  category,
  isAdmin,
  cities = [],
  cityCentroids = {},
}: {
  offers: Offer[];
  category: "food" | "days-out" | "all";
  isAdmin?: boolean;
  cities?: City[];
  cityCentroids?: Record<string, [number, number]>;
}) {
  const [expanded, setExpanded] = useState(false);
  // Merged view: quick filter between food deals and money-off/ticket deals.
  const [cat, setCat] = useState<"all" | "food" | "days-out">("all");
  // Region "near me" filter — local deals for this region float to the top.
  const [region, setRegion] = useState<string | null>(null);
  const [geoBusy, setGeoBusy] = useState(false);
  const [geoErr, setGeoErr] = useState<string | null>(null);

  // Remember the visitor's region choice across visits.
  useEffect(() => {
    try {
      const saved = localStorage.getItem(REGION_KEY);
      if (saved && cities.some((c) => c.slug === saved)) setRegion(saved);
    } catch { /* ignore */ }
  }, [cities]);

  function chooseRegion(slug: string | null) {
    setRegion(slug);
    setExpanded(false);
    setGeoErr(null);
    try {
      if (slug) localStorage.setItem(REGION_KEY, slug);
      else localStorage.removeItem(REGION_KEY);
    } catch { /* ignore */ }
  }

  // GPS → nearest region (coords never leave the browser).
  function useMyLocation() {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setGeoErr("Location isn't available on this device.");
      return;
    }
    setGeoBusy(true);
    setGeoErr(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords;
        let best: string | null = null;
        let bestD = Infinity;
        const cosLat = Math.cos((latitude * Math.PI) / 180);
        for (const c of cities) {
          const cc = cityCentroids[c.slug];
          if (!cc) continue;
          const dx = (cc[1] - longitude) * cosLat;
          const dy = cc[0] - latitude;
          const d = dx * dx + dy * dy;
          if (d < bestD) { bestD = d; best = c.slug; }
        }
        setGeoBusy(false);
        if (best) chooseRegion(best);
        else setGeoErr("Couldn't match your location to a region.");
      },
      () => { setGeoBusy(false); setGeoErr("Couldn't get your location — pick a region instead."); },
      { timeout: 8000, maximumAge: 600000 },
    );
  }

  const regionCity = region ? cities.find((c) => c.slug === region) ?? null : null;
  const regionId = regionCity?.id ?? null;

  // Apply the food / days-out quick filter first.
  const catFiltered = useMemo(
    () => (category === "all" && cat !== "all" ? offers.filter((o) => o.category === cat) : offers),
    [offers, category, cat],
  );

  // Split into local-for-this-region and everywhere-else once a region is set.
  const localOffers = useMemo(
    () => (regionId ? catFiltered.filter((o) => o.scope !== "national" && o.city_id === regionId) : []),
    [catFiltered, regionId],
  );
  const everywhere = useMemo(
    () => (regionId ? catFiltered.filter((o) => o.scope === "national") : catFiltered),
    [catFiltered, regionId],
  );
  const everywhereShown = expanded ? everywhere : everywhere.slice(0, INITIAL_CAP);

  if (offers.length === 0) {
    return (
      <div className="card p-12 text-center">
        <div className="text-5xl mb-3">🎟️</div>
        <h2 className="h-display text-3xl mb-2">No deals here yet</h2>
        <p className="text-buzz-mute max-w-md mx-auto mb-5">Check back soon — we'll add money-saving deals for families here.</p>
        <Link href="/submit-offer" className="btn-secondary">Know a deal? Tell us →</Link>
      </div>
    );
  }

  const card = (o: Offer) => (
    <div key={o.id} className="card p-5 flex flex-col gap-2">
      <div className="flex items-start gap-2 flex-wrap">
        <span className="inline-flex items-center rounded-full bg-buzz-accent/15 text-buzz-accent text-[11px] font-bold uppercase tracking-wider px-2.5 py-1">
          {(category === "all" ? o.category : category) === "food" ? "🍽️ Eating out" : "🎟️ Tickets & days out"}
        </span>
        {o.scope === "national" && (
          <span className="inline-flex items-center rounded-full bg-buzz-surface border border-buzz-border text-[11px] font-medium px-2.5 py-1">
            UK-wide
          </span>
        )}
        {o.ends_on && (
          <span className="inline-flex items-center rounded-full bg-amber-400/15 text-amber-600 text-[11px] font-semibold px-2.5 py-1">
            ⏳ Until {new Date(o.ends_on + "T12:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
          </span>
        )}
      </div>
      <h3 className="font-display text-xl uppercase leading-tight">{o.title}</h3>
      {o.provider && <div className="text-sm text-buzz-text font-medium -mt-1">{o.provider}</div>}
      {o.description && <p className="text-sm text-buzz-mute">{o.description}</p>}
      {o.terms && (
        <p className="text-xs text-buzz-mute/90 mt-1 bg-buzz-surface/60 border border-buzz-border rounded-lg px-3 py-2">
          ℹ️ {o.terms}
        </p>
      )}
      <div className="mt-auto pt-2 flex flex-col gap-2">
        <div className="flex items-center gap-x-4 gap-y-1 flex-wrap">
          {o.url && (
            <Link href={o.url} target="_blank" rel="noreferrer" className="text-sm text-buzz-accent hover:underline font-medium">
              View the offer →
            </Link>
          )}
          {o.business_url && o.business_url !== o.url && (
            <Link href={o.business_url} target="_blank" rel="noreferrer" className="text-sm text-buzz-mute hover:text-buzz-accent">
              🌐 {host(o.business_url)}
            </Link>
          )}
        </div>
        <OfferReportButton offerId={o.id} />
        {isAdmin && <AdminDeleteButton kind="offer" id={o.id} name={o.title} className="mt-1" />}
      </div>
    </div>
  );

  return (
    <div>
      <p className="text-sm text-buzz-mute mb-5 max-w-2xl">
        Kids eat free, £1 meals, vouchers and money off tickets — always double-check the small print and your local branch before you go.
      </p>

      {/* Region "near me" filter */}
      {cities.length > 0 && (
        <div className="mb-5 flex flex-wrap items-center gap-2">
          <span className="text-sm text-buzz-mute">📍 Deals near</span>
          <select
            value={region ?? ""}
            onChange={(e) => chooseRegion(e.target.value || null)}
            className="h-9 rounded-lg border border-buzz-border bg-buzz-card px-3 text-sm"
          >
            <option value="">All of Scotland</option>
            {cities.map((c) => (
              <option key={c.slug} value={c.slug}>{c.name}</option>
            ))}
          </select>
          <button onClick={useMyLocation} disabled={geoBusy} className="filter-pill disabled:opacity-50">
            {geoBusy ? "Locating…" : "Use my location"}
          </button>
          {region && (
            <button onClick={() => chooseRegion(null)} className="text-xs text-buzz-mute hover:text-buzz-accent underline">
              clear
            </button>
          )}
          {geoErr && <span className="text-xs text-rose-500 w-full">{geoErr}</span>}
        </div>
      )}

      {/* Food / days-out quick filter */}
      {category === "all" && (
        <div className="mb-6 flex flex-wrap gap-2">
          <button onClick={() => { setCat("all"); setExpanded(false); }} className={cat === "all" ? "filter-pill filter-pill-active" : "filter-pill"}>
            All deals ({offers.length})
          </button>
          <button onClick={() => { setCat("food"); setExpanded(false); }} className={cat === "food" ? "filter-pill filter-pill-active" : "filter-pill"}>
            🍽️ Food deals ({offers.filter((o) => o.category === "food").length})
          </button>
          <button onClick={() => { setCat("days-out"); setExpanded(false); }} className={cat === "days-out" ? "filter-pill filter-pill-active" : "filter-pill"}>
            🎟️ Money off ({offers.filter((o) => o.category === "days-out").length})
          </button>
        </div>
      )}

      {/* Local deals for the chosen region */}
      {regionId && (
        <section className="mb-8">
          <h2 className="font-display text-2xl mb-1">In {regionCity?.name}</h2>
          {localOffers.length > 0 ? (
            <>
              <p className="text-sm text-buzz-mute mb-4">Local deals just for {regionCity?.name}.</p>
              <div className="grid sm:grid-cols-2 gap-4">{localOffers.map(card)}</div>
            </>
          ) : (
            <p className="text-sm text-buzz-mute mb-2">
              No local {cat === "food" ? "food " : cat === "days-out" ? "days-out " : ""}deals in {regionCity?.name} yet — here&apos;s what works everywhere.{" "}
              <Link href="/submit-offer" className="text-buzz-accent hover:underline">Know one? Tell us →</Link>
            </p>
          )}
        </section>
      )}

      {/* Everywhere / all deals */}
      {regionId && everywhere.length > 0 && (
        <h2 className="font-display text-2xl mb-3">Available everywhere 🏴󠁧󠁢󠁳󠁣󠁴󠁿</h2>
      )}
      {everywhereShown.length === 0 && !regionId && (
        <div className="card p-8 text-center text-buzz-mute text-sm">Nothing in this category yet.</div>
      )}
      <div className="grid sm:grid-cols-2 gap-4">{everywhereShown.map(card)}</div>

      {everywhere.length > INITIAL_CAP && (
        <div className="mt-6 text-center">
          <button onClick={() => setExpanded((v) => !v)} className="btn-secondary">
            {expanded ? "Show fewer" : `Show all ${everywhere.length} →`}
          </button>
        </div>
      )}

      <div className="mt-8 card p-5 text-center bg-buzz-accent/5 border-buzz-accent/30">
        <p className="text-sm text-buzz-mute mb-3">Know a deal we've missed? Help other families out.</p>
        <Link href="/submit-offer" className="btn-secondary">🙌 Suggest a deal →</Link>
      </div>
    </div>
  );
}
