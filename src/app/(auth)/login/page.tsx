"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next") || "/dashboard";
  // Auth callback may bounce the user here with ?error=... when an email
  // link is expired / invalid — surface that on first paint.
  const initialError = params.get("error");

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(initialError);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      setLoading(false);
      setError(error.message);
      return;
    }
    // Force a full page navigation so the server picks up the new auth cookie.
    // router.replace() does a client-side soft nav that often beats the cookie
    // and shows the user as logged out until they manually refresh.
    window.location.assign(next);
  }

  return (
    <form onSubmit={onSubmit} className="card p-6 flex flex-col gap-4">
      <div>
        <label className="label">Email</label>
        <input className="input" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
      </div>
      <div>
        <label className="label">Password</label>
        <input className="input" type="password" required value={password} onChange={(e) => setPassword(e.target.value)} />
      </div>
      {error && <div className="text-sm text-buzz-accent2">{error}</div>}
      <button type="submit" className="btn-primary" disabled={loading}>
        {loading ? "Signing in…" : "Sign in"}
      </button>
      <p className="text-sm text-buzz-mute text-center">
        New here? <Link href="/signup" className="text-buzz-accent">Create an account</Link>
      </p>
    </form>
  );
}

export default function LoginPage() {
  return (
    <div className="max-w-md mx-auto px-4 py-12">
      <h1 className="font-display text-3xl font-bold mb-2">Sign in</h1>
      <p className="text-buzz-mute mb-6">For venues, artists, DJs and event organisers. Just browsing? Visit a city page.</p>
      <Suspense fallback={<div className="card p-6 text-buzz-mute">Loading…</div>}>
        <LoginForm />
      </Suspense>
    </div>
  );
}
