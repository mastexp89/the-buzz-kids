import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { CIRCUS, circusClosed } from "@/lib/competition";

// Where users land after clicking an email confirmation, magic link,
// password reset, or OAuth callback.
//
// Three flows to support:
//   1. token_hash (RECOMMENDED for email links) — stateless, the
//      Supabase email template uses {{ .TokenHash }}. Works across
//      devices/browsers because verification doesn't need any
//      client-side stored state. Server calls verifyOtp(token_hash,
//      type) to confirm and sets the session cookie.
//   2. PKCE — token arrives in ?code= query param. Server-side
//      exchangeCodeForSession needs the code verifier stored in the
//      user's signup browser session — breaks if they click the link
//      on a different device. Kept for OAuth which always uses PKCE.
//   3. Implicit — tokens arrive in URL fragment (#access_token=...).
//      The server can't see fragments — they're browser-only — so we
//      serve a tiny HTML shim that hands the fragment off to a client
//      page (/auth/callback-finish) which uses the Supabase JS client
//      to set the session via cookies.
//
// For cross-device email confirmation to work, the Supabase email
// template MUST use token_hash, not ConfirmationURL. The template
// should be:
//   {{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}&type=email&next=/dashboard
// Same applies to the password reset template with type=recovery.
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type");
  const next = searchParams.get("next") ?? "/dashboard";
  const errorParam = searchParams.get("error");
  const errorDescription = searchParams.get("error_description");

  // Provider returned an error directly (e.g. expired link, bad token)
  if (errorParam) {
    const reason = encodeURIComponent(errorDescription || errorParam);
    return NextResponse.redirect(`${origin}/login?error=${reason}`);
  }

  // token_hash path — stateless verification, works cross-device.
  // Supabase email templates should use this format.
  if (tokenHash && type) {
    const supabase = await createClient();
    const { error } = await supabase.auth.verifyOtp({
      token_hash: tokenHash,
      // Cast: Supabase accepts "signup" | "invite" | "magiclink" |
      // "recovery" | "email_change" | "email" — query string is
      // unconstrained but the SDK validates at runtime.
      type: type as any,
    });
    if (error) {
      const reason = encodeURIComponent(
        error.message ||
          "Couldn't verify that link — it may have expired or already been used.",
      );
      return NextResponse.redirect(`${origin}/login?error=${reason}`);
    }
    // Password-reset links arrive with type=recovery — bounce the user
    // into the reset-password page instead of the default dashboard so
    // they actually get to change their password.
    if (type === "recovery") {
      return NextResponse.redirect(`${origin}/auth/update-password`);
    }
    // Competition hook: a freshly-confirmed signup while a competition is
    // open → land them on the competition page, which auto-enters them.
    // Without this they'd hit /dashboard and never get entered.
    if ((type === "email" || type === "signup") && CIRCUS.open && !circusClosed()) {
      return NextResponse.redirect(`${origin}/win-circus`);
    }
    return NextResponse.redirect(`${origin}${next}`);
  }

  // PKCE path — server-side exchange and redirect.
  // Used by OAuth providers which always emit ?code=.
  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      const reason = encodeURIComponent(error.message || "Couldn't verify that link — it may have expired.");
      return NextResponse.redirect(`${origin}/login?error=${reason}`);
    }
    return NextResponse.redirect(`${origin}${next}`);
  }

  // Implicit path — no ?code=, must have tokens in URL fragment.
  // Serve a tiny HTML page that re-redirects to /auth/callback-finish
  // with the fragment intact. The fragment survives the client-side
  // redirect because browsers handle # locally.
  const escapedNext = next.replace(/[<>'"&]/g, "");
  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Signing you in…</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>body{background:#0a0a0d;color:#f4f4f5;font-family:-apple-system,sans-serif;text-align:center;padding:60px 20px;}p{color:#8a8a96;}</style>
</head>
<body>
  <p>Signing you in…</p>
  <script>
    var nextPath = ${JSON.stringify(escapedNext)};
    var sep = window.location.hash ? "&" : "";
    var dest = "/auth/callback-finish?next=" + encodeURIComponent(nextPath) + window.location.hash;
    window.location.replace(dest);
  </script>
  <noscript>JavaScript required to complete sign-in. Please enable JavaScript and reload.</noscript>
</body>
</html>`;

  return new Response(html, {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}
