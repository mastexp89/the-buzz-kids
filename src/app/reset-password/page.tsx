"use client";

// Set-a-new-password page. The user lands here after clicking the
// recovery link in the email and being passed through /auth/callback →
// /auth/callback-finish (which sees type=recovery in the URL fragment
// and redirects here with the session already cookied).
//
// At this point the user is technically "signed in" via the recovery
// token — but the only thing they should be able to do is update their
// password. We don't drop them on the dashboard until after they've
// chosen a new one.

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function ResetPasswordPage() {
  const router = useRouter();
  const [supabase] = useState(() => createClient());
  const [checking, setChecking] = useState(true);
  const [authed, setAuthed] = useState(false);
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  // Sanity check: a user with no recovery session shouldn't land here
  // directly. If they do, bounce them to /login.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase.auth.getUser();
      if (cancelled) return;
      if (!data.user) {
        router.replace("/login?error=" + encodeURIComponent("Recovery link expired — request a new one."));
        return;
      }
      setAuthed(true);
      setChecking(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [router, supabase]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (pw.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (pw !== pw2) {
      setError("Passwords don't match.");
      return;
    }
    setSubmitting(true);
    const { error } = await supabase.auth.updateUser({ password: pw });
    setSubmitting(false);
    if (error) {
      setError(error.message);
      return;
    }
    setDone(true);
    // Give the user a beat to see the success state before bouncing.
    setTimeout(() => {
      window.location.assign("/dashboard");
    }, 1200);
  }

  if (checking) {
    return (
      <div className="container-page py-20 text-center">
        <p className="text-buzz-mute">Loading…</p>
      </div>
    );
  }

  if (!authed) return null;

  if (done) {
    return (
      <div className="container-page py-20 text-center max-w-md mx-auto">
        <div className="text-5xl mb-3" aria-hidden>✓</div>
        <h1 className="h-display text-3xl mb-2">Password updated</h1>
        <p className="text-buzz-mute">Sending you to your dashboard…</p>
      </div>
    );
  }

  return (
    <div className="max-w-md mx-auto px-4 py-16">
      <p className="eyebrow mb-2">Account</p>
      <h1 className="h-display text-4xl mb-2">Set a new password</h1>
      <p className="text-buzz-mute mb-6">
        Pick something at least 8 characters long. You'll be signed in
        straight away once it's saved.
      </p>
      <form onSubmit={onSubmit} className="card p-6 flex flex-col gap-4">
        <div>
          <label className="label">New password</label>
          <input
            type="password"
            className="input"
            required
            minLength={8}
            autoFocus
            autoComplete="new-password"
            value={pw}
            onChange={(e) => setPw(e.target.value)}
          />
          <p className="help">At least 8 characters.</p>
        </div>
        <div>
          <label className="label">Confirm new password</label>
          <input
            type="password"
            className="input"
            required
            minLength={8}
            autoComplete="new-password"
            value={pw2}
            onChange={(e) => setPw2(e.target.value)}
          />
        </div>
        {error && <div className="text-sm text-rose-400">{error}</div>}
        <button type="submit" className="btn-primary" disabled={submitting}>
          {submitting ? "Saving…" : "Save new password"}
        </button>
      </form>
    </div>
  );
}
