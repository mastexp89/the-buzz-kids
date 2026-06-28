"use client";

import { useCallback, useState } from "react";
import CheckoutModal from "./CheckoutModal";

type Props = {
  venueId: string;
  trialEndsAt: string | null;
  subscriptionStatus: string | null;
  currentPeriodEnd: string | null;
};

export default function SubscriptionBanner({
  venueId,
  trialEndsAt,
  subscriptionStatus,
  currentPeriodEnd,
}: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [checkoutOpen, setCheckoutOpen] = useState(false);

  const fetchSubscriptionClientSecret = useCallback(async () => {
    const json = await safeFetchJson("/api/stripe/checkout/subscription", { venueId, embedded: true });
    if (!json.clientSecret) throw new Error(json.error ?? "No client secret returned");
    return json.clientSecret as string;
  }, [venueId]);

  const isActive = subscriptionStatus === "active" || subscriptionStatus === "trialing";
  const isPastDue = subscriptionStatus === "past_due" || subscriptionStatus === "unpaid";
  const isCancelled = subscriptionStatus === "canceled";

  const trialEnd = trialEndsAt ? new Date(trialEndsAt) : null;
  const trialDaysLeft = trialEnd ? Math.ceil((trialEnd.getTime() - Date.now()) / 86_400_000) : 0;
  const inTrial = !isActive && trialEnd && trialDaysLeft > 0;
  const trialOver = !isActive && trialEnd && trialDaysLeft <= 0;

  async function safeFetchJson(url: string, body?: any) {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let json: any = {};
    try { json = text ? JSON.parse(text) : {}; } catch {}
    if (!res.ok) {
      throw new Error(json.error ?? text?.slice(0, 200) ?? `Server error (${res.status})`);
    }
    return json;
  }

  function startSubscribe() {
    setError(null);
    setCheckoutOpen(true);
  }

  async function openPortal() {
    setBusy(true);
    setError(null);
    try {
      const json = await safeFetchJson("/api/stripe/portal");
      if (!json.url) throw new Error("No portal URL returned");
      window.location.href = json.url;
    } catch (e: any) {
      setError(e.message);
      setBusy(false);
    }
  }

  // ---- States ----
  if (isActive) {
    const periodEnd = currentPeriodEnd ? new Date(currentPeriodEnd) : null;
    return (
      <div className="card p-4 border-emerald-500/40 bg-emerald-500/5 flex items-start gap-3">
        <span className="text-xl">✅</span>
        <div className="flex-1">
          <div className="font-semibold text-emerald-300">Subscription active</div>
          <div className="text-buzz-mute text-sm mt-0.5">
            £5/week. {periodEnd && <>Next bill {periodEnd.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}.</>}
          </div>
        </div>
        <button onClick={openPortal} disabled={busy} className="btn-secondary text-sm">
          {busy ? "…" : "Manage billing"}
        </button>
      </div>
    );
  }

  if (isPastDue) {
    return (
      <div className="card p-4 border-rose-500/40 bg-rose-500/10 flex items-start gap-3">
        <span className="text-xl">⚠️</span>
        <div className="flex-1">
          <div className="font-semibold text-rose-300">Payment failed</div>
          <div className="text-buzz-mute text-sm mt-0.5">
            Your last payment didn't go through. Update your card to keep your venue listed.
          </div>
          {error && <div className="text-xs text-rose-400 mt-1">{error}</div>}
        </div>
        <button onClick={openPortal} disabled={busy} className="btn-primary text-sm">
          {busy ? "…" : "Update card"}
        </button>
      </div>
    );
  }

  if (isCancelled) {
    return (
      <div className="card p-4 border-buzz-accent/40 bg-buzz-accent/5 flex items-start gap-3">
        <span className="text-xl">🐝</span>
        <div className="flex-1">
          <div className="font-semibold text-buzz-accent">Subscription cancelled</div>
          <div className="text-buzz-mute text-sm mt-0.5">
            Resubscribe any time to relist your venue.
          </div>
          {error && <div className="text-xs text-rose-400 mt-1">{error}</div>}
        </div>
        <button onClick={startSubscribe} disabled={busy} className="btn-primary text-sm">
          {busy ? "…" : "Resubscribe — £5/wk"}
        </button>
      </div>
    );
  }

  if (trialOver) {
    return (
      <div className="card p-4 border-rose-500/40 bg-rose-500/10 flex items-start gap-3">
        <span className="text-xl">⏰</span>
        <div className="flex-1">
          <div className="font-semibold text-rose-300">Trial ended</div>
          <div className="text-buzz-mute text-sm mt-0.5">
            Subscribe at £5/week to keep your venue listed publicly.
          </div>
          {error && <div className="text-xs text-rose-400 mt-1">{error}</div>}
        </div>
        <button onClick={startSubscribe} disabled={busy} className="btn-primary text-sm">
          {busy ? "…" : "Subscribe — £5/wk"}
        </button>
      </div>
    );
  }

  if (inTrial) {
    return (
      <div className="card p-4 border-buzz-accent/40 bg-buzz-accent/5 flex items-start gap-3">
        <span className="text-xl">🎉</span>
        <div className="flex-1">
          <div className="font-semibold text-buzz-accent">
            Free trial — {trialDaysLeft} day{trialDaysLeft === 1 ? "" : "s"} left
          </div>
          <div className="text-buzz-mute text-sm mt-0.5">
            You're listed free until {trialEnd!.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}. Subscribe any time to lock in £5/week.
          </div>
          {error && <div className="text-xs text-rose-400 mt-1">{error}</div>}
        </div>
        <button onClick={startSubscribe} disabled={busy} className="btn-primary text-sm">
          {busy ? "…" : "Subscribe early"}
        </button>
      </div>
    );
  }

  // Fallback (no trial set yet — shouldn't happen with the migration)
  return (
    <div className="card p-4 flex items-start gap-3">
      <span className="text-xl">💳</span>
      <div className="flex-1">
        <div className="font-semibold">Subscribe to list publicly</div>
        <div className="text-buzz-mute text-sm mt-0.5">£5/week, cancel any time.</div>
        {error && <div className="text-xs text-rose-400 mt-1">{error}</div>}
      </div>
      <button onClick={startSubscribe} disabled={busy} className="btn-primary text-sm">
        {busy ? "…" : "Subscribe"}
      </button>
    </div>
  );
}
