"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { recordSignup } from "./actions";

// Self-serve signup is parent/carer ("fan") only. Businesses no longer sign
// up here — they reach an account via "Claim this listing" on a place, or the
// "List your activity" page. Anyone arriving with ?as=venue / ?as=organiser is
// redirected there.
function SignupForm() {
  const router = useRouter();
  const params = useSearchParams();
  const urlType = params.get("as");
  const next = params.get("next");

  // Bounce business/organiser intents to the dedicated listing flow.
  const redirectToListing = urlType === "venue" || urlType === "organiser";
  useEffect(() => {
    if (redirectToListing) router.replace("/list-your-activity");
  }, [redirectToListing, router]);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const supabase = createClient();

    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: `${process.env.NEXT_PUBLIC_SITE_URL || window.location.origin}/auth/callback`,
        data: {
          display_name: name,
          account_type: "fan",
        },
      },
    });

    if (error) {
      setLoading(false);
      setError(error.message);
      return;
    }

    recordSignup({ displayName: name, email, accountType: "fan" }).catch(() => {});

    if (data.user && !data.session) {
      router.replace(`/check-email?email=${encodeURIComponent(email)}`);
    } else {
      // Parents skip the setup wizard — drop them on their favourites page
      // (or wherever they were headed when they hit the signup wall).
      window.location.assign(next || "/dashboard/favourites");
    }
  }

  if (redirectToListing) {
    return (
      <div className="max-w-md mx-auto px-4 py-12 text-buzz-mute">
        Taking you to the listing form…
      </div>
    );
  }

  return (
    <div className="max-w-md mx-auto px-4 py-12">
      <p className="eyebrow mb-2">Create an account</p>
      <h1 className="h-display text-4xl mb-2">Plan your days out.</h1>
      <p className="text-buzz-mute mb-6">
        Free parent account. Save places to your bucket list, review the ones you've
        been to and hear about new activities each school holiday.
      </p>

      <form onSubmit={onSubmit} className="card p-6 flex flex-col gap-4">
        <div>
          <label className="label">Your name</label>
          <input
            className="input"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Your first name"
          />
          <p className="help">What should we call you? Used on your reviews and emails.</p>
        </div>
        <div>
          <label className="label">Email</label>
          <input className="input" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div>
          <label className="label">Password</label>
          <input className="input" type="password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} />
          <p className="help">At least 8 characters.</p>
        </div>
        {error && <div className="text-sm text-rose-400">{error}</div>}
        <button type="submit" className="btn-primary" disabled={loading}>
          {loading ? "Creating account…" : "Create account"}
        </button>
        <p className="text-sm text-buzz-mute text-center">
          Already have an account? <Link href="/login" className="text-buzz-accent">Sign in</Link>
        </p>
      </form>

      <p className="text-sm text-buzz-mute text-center mt-6">
        Run a place or activity?{" "}
        <Link href="/list-your-activity" className="text-buzz-accent hover:underline">
          List it free
        </Link>
      </p>
    </div>
  );
}

export default function SignupPage() {
  return (
    <Suspense fallback={<div className="max-w-md mx-auto px-4 py-12 text-buzz-mute">Loading…</div>}>
      <SignupForm />
    </Suspense>
  );
}
