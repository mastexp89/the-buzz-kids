"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

export default function UpdatePasswordPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [ready, setReady] = useState(false);

  // When the user clicks the password-reset link in their email, Supabase puts
  // a recovery session in the URL hash. The client picks this up automatically.
  // We wait for the auth state to settle before showing the form.
  useEffect(() => {
    const supabase = createClient();
    let cancelled = false;

    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (cancelled) return;
      setReady(!!session);
    })();

    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (cancelled) return;
      if (event === "PASSWORD_RECOVERY" || event === "SIGNED_IN") {
        setReady(!!session);
      }
    });

    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setInfo(null);

    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      setError("Passwords don't match.");
      return;
    }

    setLoading(true);
    const supabase = createClient();
    const { error } = await supabase.auth.updateUser({ password });
    setLoading(false);

    if (error) {
      setError(error.message);
      return;
    }
    setInfo("Password updated. Redirecting…");
    setTimeout(() => router.replace("/dashboard"), 1200);
  }

  return (
    <div className="max-w-md mx-auto px-4 py-12">
      <h1 className="font-display text-3xl font-bold mb-2">Set a new password</h1>
      <p className="text-buzz-mute mb-6">
        Pick a new password for your account. At least 8 characters.
      </p>

      {!ready ? (
        <div className="card p-6 text-buzz-mute">
          Verifying reset link…
          <p className="text-sm mt-3">
            If this stays here, the link may have expired.{" "}
            <Link href="/login" className="text-buzz-accent hover:text-buzz-accent2">
              Request a new one
            </Link>
            .
          </p>
        </div>
      ) : (
        <form onSubmit={onSubmit} className="card p-6 flex flex-col gap-4">
          <div>
            <label className="label">New password</label>
            <input
              className="input"
              type="password"
              required
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
            />
          </div>
          <div>
            <label className="label">Confirm new password</label>
            <input
              className="input"
              type="password"
              required
              minLength={8}
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              autoComplete="new-password"
            />
          </div>
          {error && <div className="text-sm text-rose-400">{error}</div>}
          {info && <div className="text-sm text-emerald-400">{info}</div>}
          <button type="submit" className="btn-primary" disabled={loading}>
            {loading ? "Saving…" : "Update password"}
          </button>
        </form>
      )}
    </div>
  );
}
