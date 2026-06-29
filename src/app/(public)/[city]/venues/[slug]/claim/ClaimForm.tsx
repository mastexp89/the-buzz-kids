"use client";

import { useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import {
  submitVenueClaim,
  attachClaimAfterSignup,
  type SubmitClaimResult,
} from "./actions";

type BusinessType = "individual" | "multiple" | "agency";

const BUSINESS_TYPES: { value: BusinessType; label: string; hint: string }[] = [
  { value: "individual", label: "Individual", hint: "Just this one place" },
  { value: "multiple", label: "Multiple places", hint: "I run more than one" },
  { value: "agency", label: "Agency", hint: "I manage on their behalf" },
];

export default function ClaimForm({
  venueId,
  venueName,
  loggedIn,
  defaultEmail,
  defaultName,
  loginNext,
}: {
  venueId: string;
  venueName: string;
  loggedIn: boolean;
  defaultEmail: string;
  defaultName: string;
  loginNext: string;
}) {
  // Split a pre-filled display name into first/last for the two fields.
  const [firstName, ...restName] = (defaultName || "").split(" ");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ venueName: string; checkEmail: boolean } | null>(null);
  const [businessType, setBusinessType] = useState<BusinessType | "">("");
  const [showPw, setShowPw] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const form = e.currentTarget;
    const fd = new FormData(form);

    if (!businessType) {
      setError("Please choose what kind of operator you are.");
      return;
    }
    if (!fd.get("authorised_rep")) {
      setError("Please confirm you're an authorised representative.");
      return;
    }
    if (!fd.get("accepted_terms")) {
      setError("Please accept the terms to continue.");
      return;
    }
    fd.set("business_type", businessType);

    setBusy(true);
    try {
      if (loggedIn) {
        // Existing account — submit the claim directly under their session.
        fd.set("venue_id", venueId);
        const r: SubmitClaimResult = await submitVenueClaim(fd);
        if ("error" in r) {
          setError(r.error);
        } else {
          setResult({ venueName: r.venueName, checkEmail: false });
        }
        return;
      }

      // Logged-out — create the account first, then attach the claim.
      const email = String(fd.get("contact_email") ?? "").trim();
      const password = String(fd.get("password") ?? "");
      const first = String(fd.get("first_name") ?? "").trim();
      const last = String(fd.get("last_name") ?? "").trim();
      const fullName = [first, last].filter(Boolean).join(" ");

      const supabase = createClient();
      const { data, error: signErr } = await supabase.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: `${process.env.NEXT_PUBLIC_SITE_URL || window.location.origin}/auth/callback`,
          data: {
            display_name: fullName,
            account_type: "venue",
            business_name: String(fd.get("business_name") ?? "").trim(),
          },
        },
      });
      if (signErr) {
        setError(signErr.message);
        return;
      }
      if (!data.user) {
        setError("Couldn't create your account — please try again.");
        return;
      }

      // Hand the claim details to the server, keyed to the new user id.
      const plain: Record<string, string> = {};
      fd.forEach((v, k) => {
        if (k !== "password") plain[k] = String(v);
      });
      // Checkboxes only appear in FormData when ticked — normalise to "true".
      plain.authorised_rep = "true";
      plain.accepted_terms = "true";

      const r = await attachClaimAfterSignup({
        userId: data.user.id,
        email,
        venueId,
        formData: plain,
      });
      if ("error" in r) {
        setError(r.error);
        return;
      }
      // No session means Supabase sent a confirmation email.
      setResult({ venueName: r.venueName, checkEmail: !data.session });
    } finally {
      setBusy(false);
    }
  }

  if (result) {
    return (
      <div className="card p-8 text-center">
        <div className="text-5xl mb-3">{result.checkEmail ? "📧" : "📨"}</div>
        <h2 className="h-display text-3xl mb-2">
          {result.checkEmail ? "Almost there!" : "Claim submitted"}
        </h2>
        <p className="text-buzz-mute mb-4 max-w-md mx-auto">
          {result.checkEmail ? (
            <>
              We've sent a confirmation link to your email. Click it to verify your
              account — then your claim on{" "}
              <strong className="text-buzz-text">{result.venueName}</strong> goes into
              our review queue. We usually approve within 24–48 hours.
            </>
          ) : (
            <>
              Thanks — your claim on{" "}
              <strong className="text-buzz-text">{result.venueName}</strong> is now in
              our review queue. We'll email you as soon as it's approved (usually within
              24–48 hours).
            </>
          )}
        </p>
        <Link href="/" className="btn-secondary">Back to home</Link>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="card p-6 grid sm:grid-cols-2 gap-4">
      {!loggedIn && (
        <p className="sm:col-span-2 text-sm text-buzz-mute -mt-1">
          Already have an account?{" "}
          <Link href={`/login?next=${encodeURIComponent(loginNext)}`} className="text-buzz-accent hover:underline">
            Sign in first
          </Link>{" "}
          and we'll skip this bit.
        </p>
      )}

      <div>
        <label className="label">First name *</label>
        <input name="first_name" className="input" required maxLength={80} defaultValue={firstName ?? ""} placeholder="Alex" />
      </div>
      <div>
        <label className="label">Last name *</label>
        <input name="last_name" className="input" required maxLength={80} defaultValue={restName.join(" ")} placeholder="Smith" />
      </div>

      <div className="sm:col-span-2">
        <label className="label">Business name *</label>
        <input name="business_name" className="input" required maxLength={160} placeholder="e.g. Happy Days Soft Play" />
        <p className="help">The name of your attraction, club or the business that runs it.</p>
      </div>

      {!loggedIn && (
        <>
          <div className="sm:col-span-2">
            <label className="label">Email address *</label>
            <input
              name="contact_email"
              type="email"
              className="input"
              required
              maxLength={200}
              defaultValue={defaultEmail}
              autoComplete="email"
              placeholder="you@email.com"
            />
            <p className="help">You'll need to verify this before your claim is approved.</p>
          </div>
          <div className="sm:col-span-2">
            <label className="label">Password *</label>
            <div className="relative">
              <input
                name="password"
                type={showPw ? "text" : "password"}
                className="input pr-16"
                required
                minLength={8}
                autoComplete="new-password"
                placeholder="At least 8 characters"
              />
              <button
                type="button"
                onClick={() => setShowPw((s) => !s)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-buzz-mute hover:text-buzz-accent"
              >
                {showPw ? "Hide" : "Show"}
              </button>
            </div>
            <p className="help">At least 8 characters.</p>
          </div>
        </>
      )}

      <div className="sm:col-span-2">
        <label className="label">Contact phone</label>
        <input name="contact_phone" className="input" maxLength={40} placeholder="07…" autoComplete="tel" />
        <p className="help">This will NOT be visible to website users — just for us to reach you.</p>
      </div>

      <div className="sm:col-span-2">
        <label className="label">What kind of operator are you? *</label>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mt-1">
          {BUSINESS_TYPES.map((t) => {
            const active = businessType === t.value;
            return (
              <button
                type="button"
                key={t.value}
                onClick={() => setBusinessType(t.value)}
                className={
                  "text-left rounded-lg border p-3 transition " +
                  (active
                    ? "border-buzz-accent bg-buzz-accent/5"
                    : "border-buzz-border hover:border-buzz-accent/60")
                }
              >
                <div className={"font-medium " + (active ? "text-buzz-accent" : "")}>{t.label}</div>
                <div className="text-xs text-buzz-mute mt-0.5">{t.hint}</div>
              </button>
            );
          })}
        </div>
      </div>

      <div className="sm:col-span-2">
        <label className="label">Anything else? (optional)</label>
        <textarea
          name="reason"
          className="input min-h-[100px]"
          maxLength={1000}
          placeholder="A quick line to help us verify — e.g. 'I've run this since 2018', or 'my contact details are on the place's Facebook page'."
        />
      </div>

      <label className="sm:col-span-2 flex items-start gap-2 text-sm text-buzz-mute cursor-pointer">
        <input type="checkbox" name="authorised_rep" className="mt-1 shrink-0" />
        <span>
          I verify that I am an authorised representative of this business and that the
          information I've entered is true and correct to the best of my knowledge.
        </span>
      </label>
      <label className="sm:col-span-2 flex items-start gap-2 text-sm text-buzz-mute cursor-pointer">
        <input type="checkbox" name="accepted_terms" className="mt-1 shrink-0" />
        <span>
          I have read and accept the{" "}
          <Link href="/privacy" target="_blank" className="text-buzz-accent hover:underline">
            terms &amp; privacy policy
          </Link>
          .
        </span>
      </label>

      {error && <div className="sm:col-span-2 text-sm text-rose-400">{error}</div>}

      <div className="sm:col-span-2 flex flex-wrap gap-3 items-center pt-1">
        <button type="submit" className="btn-primary" disabled={busy}>
          {busy ? "Submitting…" : loggedIn ? "Submit claim" : "Create account & claim"}
        </button>
        <span className="text-xs text-buzz-mute">
          Free. We'll review and email you when it's approved.
        </span>
      </div>
    </form>
  );
}
