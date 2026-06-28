"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { submitVenueClaim, type SubmitClaimResult } from "./actions";

export default function ClaimForm({
  venueId,
  venueName,
  defaultEmail,
}: {
  venueId: string;
  venueName: string;
  defaultEmail: string;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SubmitClaimResult | null>(null);

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setResult(null);
    const fd = new FormData(e.currentTarget);
    fd.set("venue_id", venueId);
    start(async () => {
      const r = await submitVenueClaim(fd);
      if ("error" in r) setError(r.error);
      else setResult(r);
    });
  }

  if (result && "ok" in result) {
    return (
      <div className="card p-8 text-center">
        <div className="text-5xl mb-3">📨</div>
        <h2 className="h-display text-3xl mb-2">Claim submitted</h2>
        <p className="text-buzz-mute mb-4 max-w-md mx-auto">
          Thanks — your claim on <strong className="text-buzz-text">{result.venueName}</strong>{" "}
          is now in our review queue. We'll email you as soon as it's approved (usually
          within 24–48 hours).
        </p>
        <Link href="/" className="btn-secondary">Back to home</Link>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="card p-6 grid sm:grid-cols-2 gap-4">
      <div className="sm:col-span-2">
        <label className="label">Your role at {venueName} *</label>
        <input
          name="role"
          className="input"
          placeholder="Owner / Manager / Booker / etc."
          required
          maxLength={80}
        />
      </div>

      <div>
        <label className="label">Your phone</label>
        <input
          name="contact_phone"
          className="input"
          placeholder="07…"
          maxLength={40}
        />
      </div>
      <div>
        <label className="label">Email for replies</label>
        <input
          name="contact_email"
          type="email"
          className="input"
          placeholder="you@email.com"
          maxLength={200}
        />
      </div>

      <div className="sm:col-span-2">
        <label className="label">Anything else? (optional)</label>
        <textarea
          name="reason"
          className="input min-h-[120px]"
          placeholder="A quick line to help us verify — e.g. 'I've owned the place since 2018', 'You can find me on the venue's Facebook contact info', etc."
          maxLength={1000}
        />
      </div>

      {error && (
        <div className="sm:col-span-2 text-sm text-rose-400">{error}</div>
      )}

      <div className="sm:col-span-2 flex flex-wrap gap-3 items-center pt-1">
        <button type="submit" className="btn-primary" disabled={pending}>
          {pending ? "Submitting…" : "Submit claim"}
        </button>
        <span className="text-xs text-buzz-mute">
          Free. We'll review and email you when it's approved.
        </span>
      </div>
    </form>
  );
}
