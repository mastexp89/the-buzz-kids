"use client";

import { useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const supabase = createClient();
    const base = process.env.NEXT_PUBLIC_SITE_URL || window.location.origin;
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${base}/auth/update-password`,
    });
    setLoading(false);
    if (error) {
      setError(error.message);
      return;
    }
    // Always show success even if the email isn't registered — don't leak
    // which addresses have accounts.
    setSent(true);
  }

  return (
    <div className="max-w-md mx-auto px-4 py-12">
      <h1 className="font-display text-3xl font-bold mb-2">Reset your password</h1>
      <p className="text-buzz-mute mb-6">
        Enter the email you signed up with and we&apos;ll send you a link to set a new password.
      </p>

      {sent ? (
        <div className="card p-6">
          <p className="font-medium mb-2">Check your email 📩</p>
          <p className="text-buzz-mute text-sm">
            If an account exists for <strong>{email}</strong>, a reset link is on its way. It expires after
            an hour — just request another if it runs out.
          </p>
          <Link href="/login" className="btn-secondary mt-5 inline-block">Back to sign in</Link>
        </div>
      ) : (
        <form onSubmit={onSubmit} className="card p-6 flex flex-col gap-4">
          <div>
            <label className="label">Email</label>
            <input
              className="input"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
            />
          </div>
          {error && <div className="text-sm text-rose-400">{error}</div>}
          <button type="submit" className="btn-primary" disabled={loading}>
            {loading ? "Sending…" : "Send reset link"}
          </button>
          <p className="text-sm text-buzz-mute text-center">
            Remembered it? <Link href="/login" className="text-buzz-accent">Back to sign in</Link>
          </p>
        </form>
      )}
    </div>
  );
}
