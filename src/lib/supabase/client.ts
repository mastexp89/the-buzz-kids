"use client";

import { createBrowserClient } from "@supabase/ssr";

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      auth: {
        // Switch from PKCE to implicit flow for email-based auth.
        // PKCE requires a code verifier stored in the user's browser
        // session — if they sign up on desktop and click the email
        // link on their phone (or just take >10 mins), Supabase
        // throws "Flow state has expired".
        // Implicit flow uses tokens directly in the URL fragment,
        // no browser state needed → works across devices.
        flowType: "implicit",
      },
    },
  );
}
