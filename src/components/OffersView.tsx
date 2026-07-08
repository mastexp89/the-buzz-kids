"use client";

import { useState } from "react";
import Link from "next/link";
import OfferReportButton from "@/components/OfferReportButton";
import AdminDeleteButton from "@/components/AdminDeleteButton";

// Show this many offers first; the rest sit behind a "show more" button so the
// Deals / Food tabs load light and don't dump everything at once.
const INITIAL_CAP = 24;

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
};

// Trim to a tidy host label for the "visit website" link.
function host(u: string): string {
  try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return "website"; }
}

export default function OffersView({ offers, category, isAdmin }: { offers: Offer[]; category: "food" | "days-out" | "all"; isAdmin?: boolean }) {
  const [expanded, setExpanded] = useState(false);
  // Merged view: quick filter between food deals and money-off/ticket deals.
  const [cat, setCat] = useState<"all" | "food" | "days-out">("all");
  const list = category === "all" && cat !== "all" ? offers.filter((o) => o.category === cat) : offers;
  const shown = expanded ? list : list.slice(0, INITIAL_CAP);

  if (offers.length === 0) {
    return (
      <div className="card p-12 text-center">
        <div className="text-5xl mb-3">{category === "food" ? "🍽️" : "🎟️"}</div>
        <h2 className="h-display text-3xl mb-2">No deals here yet</h2>
        <p className="text-buzz-mute max-w-md mx-auto mb-5">Check back soon — we'll add money-saving deals for families here.</p>
        <Link href="/submit-offer" className="btn-secondary">Know a deal? Tell us →</Link>
      </div>
    );
  }

  return (
    <div>
      <p className="text-sm text-buzz-mute mb-5 max-w-2xl">
        {category === "food"
          ? "Where the kids can eat free or for £1. Most are national chains with branches near you — always double-check the small print and your local branch before you go."
          : category === "days-out"
          ? "Ways to do family days out for less. Most are national schemes that work across Scotland — check the details before you book."
          : "Kids eat free, £1 meals, vouchers and money off tickets — always double-check the small print and your local branch before you go."}
      </p>

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
      {shown.length === 0 && (
        <div className="card p-8 text-center text-buzz-mute text-sm">Nothing in this category yet.</div>
      )}
      <div className="grid sm:grid-cols-2 gap-4">
        {shown.map((o) => {
          return (
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
        })}
      </div>

      {list.length > INITIAL_CAP && (
        <div className="mt-6 text-center">
          <button onClick={() => setExpanded((v) => !v)} className="btn-secondary">
            {expanded ? "Show fewer" : `Show all ${list.length} →`}
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
