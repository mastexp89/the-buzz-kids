"use client";

// Magic-link landing bridge.
// Supabase's generateLink with type=magiclink returns the user with tokens
// in the URL fragment (#access_token=…&refresh_token=…). The fragment never
// reaches the server, so a regular server route can't process it.
//
// This client component reads the fragment, hands the tokens to the Supabase
// browser client (which writes auth cookies + localStorage), then hard-navs
// to /dashboard so SSR pages see the new session immediately.

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

export default function MagicBridgePage() {
  const [status, setStatus] = useState("Signing you in…");

  useEffect(() => {
    (async () => {
      const hash = window.location.hash.startsWith("#")
        ? window.location.hash.slice(1)
        : "";
      const params = new URLSearchParams(hash);
      const accessToken = params.get("access_token");
      const refreshToken = params.get("refresh_token");
      const errorDesc = params.get("error_description");

      if (errorDesc) {
        setStatus(`Sign-in failed: ${decodeURIComponent(errorDesc)}`);
        return;
      }

      if (!accessToken || !refreshToken) {
        setStatus("No sign-in tokens found. The link may have expired or already been used.");
        return;
      }

      const supabase = createClient();
      const { error } = await supabase.auth.setSession({
        access_token: accessToken,
        refresh_token: refreshToken,
      });
      if (error) {
        setStatus(`Sign-in failed: ${error.message}`);
        return;
      }

      // Hard nav so SSR cookie middleware picks the session up immediately.
      const next = new URL(window.location.href).searchParams.get("next") ?? "/dashboard";
      // Allow only relative paths to prevent open-redirect abuse.
      const safe = next.startsWith("/") && !next.startsWith("//") ? next : "/dashboard";
      window.location.assign(safe);
    })();
  }, []);

  return (
    <div className="container-page py-20 text-center">
      <p className="eyebrow mb-2">One moment…</p>
      <h1 className="h-display text-3xl mb-2">{status}</h1>
      <p className="text-buzz-mute text-sm">If this doesn't redirect, refresh the page.</p>
    </div>
  );
}
