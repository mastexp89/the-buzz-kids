"use client";

import { useState } from "react";
import Link from "next/link";
import OfferReportButton from "@/components/OfferReportButton";
import AdminDeleteButton from "@/components/AdminDeleteButton";

// Show this many offers first; the rest sit behind a "show more" button so the
// Deals / Food tabs load light and don't dump everything at once.
const INITIAL_CAP = 12;

type Offer = {
  id: string;
  category: string;
  title: string;
  provider: string | null;
  description: string | null;
  terms: string | null;
  url: string | null;
  business_url?: string | null;
  scope: string;
};

// Trim to a tidy host label for the "visit website" link.
function host(u: string): string {
  try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return "website"; }
}

export default function OffersView({ offers, category, isAdmin }: { offers: Offer[]; category: "food" | "days-out"; isAdmin?: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const shown = expanded ? offers : offers.slice(0, INITIAL_CAP);

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
          : "Ways to do family days out for less. Most are national schemes that work across Scotland — check the details before you book."}
      </p>
      <div className="grid sm:grid-cols-2 gap-4">
        {shown.map((o) => (
          <div key={o.id} className="card p-5 flex flex-col gap-2">
            <div className="flex items-start gap-2 flex-wrap">
              <span className="inline-flex items-center rounded-full bg-buzz-accent/15 text-buzz-accent text-[11px] font-bold uppercase tracking-wider px-2.5 py-1">
                {category === "food" ? "🍽️ Eating out" : "🎟️ Days out"}
              </span>
              {o.scope === "national" && (
                <span className="inline-flex items-center rounded-full bg-buzz-surface border border-buzz-border text-[11px] font-medium px-2.5 py-1">
                  UK-wide
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
        ))}
      </div>

      {offers.length > INITIAL_CAP && (
        <div className="mt-6 text-center">
          <button onClick={() => setExpanded((v) => !v)} className="btn-secondary">
            {expanded ? "Show fewer" : `Show all ${offers.length} →`}
          </button>
        </div>
      )}

      <div className="mt-8 card p-5 text-center bg-buzz-accent/5 border-buzz-accent/30">
        <p className="text-sm text-buzz-mute mb-3">Know a deal we've missed? Help other parents out.</p>
        <Link href="/submit-offer" className="btn-secondary">🙌 Suggest a deal →</Link>
      </div>
    </div>
  );
}
