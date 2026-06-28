"use client";

// Implicit-flow finishing line. The user got here from /auth/callback's
// HTML shim because their email link used the implicit flow (no PKCE
// code, just access_token + refresh_token in the URL fragment).
//
// The Supabase browser client auto-detects fragment tokens on first
// getSession() call (detectSessionInUrl is true by default) and writes
// them into the cookie store via @supabase/ssr — so the rest of the
// app sees them server-side immediately.

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function AuthCallbackFinishPage() {
  // Wrap in Suspense — required for useSearchParams in client pages
  // so Next.js can statically pre-render the shell.
  return (
    <Suspense fallback={<Loading />}>
      <Inner />
    </Suspense>
  );
}

function Loading() {
  return (
    <div className="container-page py-20 text-center">
      <p className="text-buzz-mute">Signing you in…</p>
    </div>
  );
}

function Inner() {
  const router = useRouter();
  const params = useSearchParams();
  const [status, setStatus] = useState<"working" | "error">("working");
  const [errorMsg, setErrorMsg] = useState<string>("");

  useEffect(() => {
    const supabase = createClient();
    const nextFromQuery = params.get("next");

    // Errors from Supabase land in the URL fragment too (e.g.
    // #error_description=...) — check those first before assuming success.
    const hash = typeof window !== "undefined" ? window.location.hash.substring(1) : "";
    const hashParams = new URLSearchParams(hash);
    const fragErr = hashParams.get("error_description") || hashParams.get("error");
    if (fragErr) {
      router.replace(`/login?error=${encodeURIComponent(fragErr)}`);
      return;
    }

    // Password-recovery links arrive with type=recovery in the fragment.
    // Override the post-login destination so the user lands on the
    // set-new-password form instead of the dashboard — they're "logged
    // in" via the recovery token but shouldn't be turned loose on the
    // app until they've actually picked a new password.
    const fragType = hashParams.get("type");
    const next =
      fragType === "recovery"
        ? "/reset-password"
        : nextFromQuery || "/dashboard";

    // Calling getSession() triggers the SDK's URL detection, which
    // pulls access_token/refresh_token from the fragment, sets the
    // session, and cleans the URL.
    supabase.auth.getSession().then(async ({ data, error }) => {
      if (error) {
        setStatus("error");
        setErrorMsg(error.message);
        return;
      }
      if (!data.session) {
        router.replace(`/login?error=${encodeURIComponent("Couldn't verify your sign-in link — try requesting a new one.")}`);
        return;
      }
      // Admins go straight to /admin regardless of the ?next param.
      let dest = next;
      const { data: profile } = await supabase.from("profiles").select("role").eq("id", data.session.user.id).maybeSingle();
      if (profile?.role === "admin") dest = "/admin";
      window.location.assign(dest);
    });
  }, [router, params]);

  if (status === "error") {
    return (
      <div className="container-page py-20 text-center">
        <h1 className="h-display text-3xl mb-2">Sign-in failed</h1>
        <p className="text-buzz-mute mb-6 max-w-md mx-auto">{errorMsg}</p>
        <a href="/login" className="btn-secondary">Back to sign in</a>
      </div>
    );
  }

  return (
    <div className="container-page py-20 text-center">
      <p className="text-buzz-mute">Signing you in…</p>
    </div>
  );
}
