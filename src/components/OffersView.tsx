import Link from "next/link";
import OfferReportButton from "@/components/OfferReportButton";

type Offer = {
  id: string;
  category: string;
  title: string;
  provider: string | null;
  description: string | null;
  terms: string | null;
  url: string | null;
  scope: string;
};

export default function OffersView({ offers, category }: { offers: Offer[]; category: "food" | "days-out" }) {
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
        {offers.map((o) => (
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
            <div className="mt-auto pt-2 flex items-center justify-between gap-3 flex-wrap">
              {o.url ? (
                <Link href={o.url} target="_blank" rel="noreferrer" className="text-sm text-buzz-accent hover:underline font-medium">
                  View the offer →
                </Link>
              ) : <span />}
              <OfferReportButton offerId={o.id} />
            </div>
          </div>
        ))}
      </div>

      <div className="mt-8 card p-5 text-center bg-buzz-accent/5 border-buzz-accent/30">
        <p className="text-sm text-buzz-mute mb-3">Know a deal we've missed? Help other parents out.</p>
        <Link href="/submit-offer" className="btn-secondary">🙌 Suggest a deal →</Link>
      </div>
    </div>
  );
}
