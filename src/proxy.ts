import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { updateSession } from "@/lib/supabase/middleware";

// Paths that bypass the coming-soon gate entirely.
function isBypassPath(pathname: string): boolean {
  return (
    pathname.startsWith("/admin") ||
    pathname.startsWith("/dashboard") ||
    pathname.startsWith("/auth") ||
    pathname.startsWith("/login") ||
    pathname.startsWith("/signup") ||
    pathname.startsWith("/reset-password") ||
    pathname.startsWith("/_next") ||
    pathname.startsWith("/api") ||
    /\.[a-z0-9]+$/i.test(pathname)
  );
}

// While COMING_SOON is on, signed-in staff (super admins + editors) still
// get the full site so they can preview it and add content. We only pay for
// the auth + role lookup when the request actually carries a Supabase auth
// cookie — anonymous visitors short-circuit straight to the holding page.
async function isAdminRequest(request: NextRequest): Promise<boolean> {
  const hasAuthCookie = request.cookies
    .getAll()
    .some((c) => c.name.startsWith("sb-") && c.name.includes("auth-token"));
  if (!hasAuthCookie) return false;

  try {
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          get: (name: string) => request.cookies.get(name)?.value,
          set: () => {},
          remove: () => {},
        },
      },
    );
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return false;
    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .maybeSingle();
    return profile?.role === "admin" || profile?.role === "editor";
  } catch {
    return false;
  }
}

const HOLDING_HTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>The Buzz Kids — Coming Soon</title>
  <meta name="description" content="Scotland's new guide to family days out — soft play, farms, museums, holiday clubs and more. Be the first to know when we launch." />
  <meta property="og:type" content="website" />
  <meta property="og:title" content="The Buzz Kids — Coming Soon" />
  <meta property="og:description" content="Scotland's new guide to family days out. Sign up for early access and exclusive discounts before we launch." />
  <meta property="og:image" content="__ORIGIN__/og-image.png" />
  <meta property="og:image:width" content="1200" />
  <meta property="og:image:height" content="630" />
  <meta property="og:url" content="__ORIGIN__/" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="The Buzz Kids — Coming Soon" />
  <meta name="twitter:description" content="Scotland's new guide to family days out. Sign up for early access before we launch." />
  <meta name="twitter:image" content="__ORIGIN__/og-image.png" />
  <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Inter:wght@400;500;600&display=swap" rel="stylesheet" />
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      min-height: 100svh;
      background: #F2F9FE;
      color: #16202A;
      font-family: "Inter", ui-sans-serif, system-ui, sans-serif;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 3rem 1.5rem;
      text-align: center;
    }
    img.logo {
      width: 96px;
      height: 96px;
      object-fit: contain;
      margin-bottom: 1.5rem;
    }
    .eyebrow {
      font-size: 0.7rem;
      font-weight: 600;
      letter-spacing: 0.18em;
      text-transform: uppercase;
      color: #1FA9E0;
      margin-bottom: 0.75rem;
    }
    h1 {
      font-family: "Bebas Neue", Impact, "Helvetica Neue", sans-serif;
      font-size: clamp(3.5rem, 12vw, 6rem);
      line-height: 1;
      letter-spacing: 0.01em;
      margin-bottom: 1.25rem;
    }
    h1 .k { color: #EC1E8C; }
    h1 .i { color: #1FA9E0; }
    h1 .d { color: #6FA713; }
    h1 .s { color: #F9A11B; }
    h1 .dot { color: #EC1E8C; }
    p.tag {
      color: #647682;
      font-size: 1.1rem;
      max-width: 38ch;
      line-height: 1.6;
      margin-bottom: 2rem;
    }
    .notify {
      width: 100%;
      max-width: 28rem;
      margin-bottom: 2.5rem;
    }
    .notify h2 {
      font-family: "Bebas Neue", Impact, "Helvetica Neue", sans-serif;
      font-size: 1.6rem;
      letter-spacing: 0.03em;
      margin-bottom: 0.4rem;
    }
    .notify p {
      font-size: 0.85rem;
      color: #647682;
      margin-bottom: 1rem;
      line-height: 1.5;
    }
    .notify form {
      display: flex;
      gap: 0.5rem;
      flex-wrap: wrap;
    }
    .notify input[type="email"] {
      flex: 1 1 200px;
      padding: 0.65rem 1rem;
      border-radius: 0.5rem;
      border: 1.5px solid #DCEAF3;
      font-size: 0.9rem;
      font-family: inherit;
      background: #fff;
      color: #16202A;
      outline: none;
    }
    .notify input[type="email"]:focus { border-color: #1FA9E0; }
    .notify button {
      background: #1FA9E0;
      color: #fff;
      font-weight: 600;
      font-size: 0.9rem;
      border: none;
      border-radius: 0.5rem;
      padding: 0.65rem 1.25rem;
      cursor: pointer;
      font-family: inherit;
      transition: opacity 0.15s;
      white-space: nowrap;
    }
    .notify button:hover { opacity: 0.88; }
    .notify button:disabled { opacity: 0.6; cursor: default; }
    .notify-msg {
      margin-top: 0.6rem;
      font-size: 0.8rem;
      min-height: 1.2em;
    }
    .notify-msg.ok  { color: #6FA713; }
    .notify-msg.err { color: #e53e3e; }
    footer {
      margin-top: 3.5rem;
      font-size: 0.72rem;
      color: #9DB5C4;
      line-height: 1.8;
    }
    footer a { text-decoration: none; }
    footer a:hover { opacity: 0.75; }
  </style>
</head>
<body>
  <img class="logo" src="/logo.png" alt="The Buzz Kids" />
  <p class="eyebrow">Coming soon</p>
  <h1>
    The Buzz <span class="k">K</span><span class="i">i</span><span class="d">d</span><span class="s">s</span><span class="dot">.</span>
  </h1>
  <p class="tag">
    Scotland's new guide to family days out — soft play, farms, museums, holiday clubs and more.
  </p>
  <div class="notify">
    <h2>Be the first to know.</h2>
    <p>Sign up for early access, exclusive discounts off local activities, and special offers from places near you — before we launch.</p>
    <form id="notify-form">
      <input type="email" name="email" placeholder="your@email.com" required autocomplete="email" />
      <button type="submit" id="notify-btn">Notify me →</button>
    </form>
    <p class="notify-msg" id="notify-msg"></p>
  </div>
  <footer>
    <div>A sister site to <a href="https://www.thebuzzguide.co.uk" style="color:#1FA9E0">The Buzz Guide</a>.</div>
    <div>Designed by <a href="https://www.forthhost.com" style="color:#EC1E8C">Forth Host &amp; Web Design</a>.</div>
  </footer>
  <script>
    document.getElementById('notify-form').addEventListener('submit', async function(e) {
      e.preventDefault();
      var btn = document.getElementById('notify-btn');
      var msg = document.getElementById('notify-msg');
      var email = this.email.value.trim();
      btn.disabled = true;
      btn.textContent = 'Sending…';
      msg.textContent = '';
      msg.className = 'notify-msg';
      try {
        var res = await fetch('/api/notify-signup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: email })
        });
        var json = await res.json();
        if (res.ok) {
          msg.textContent = "You're on the list! We'll be in touch before we launch.";
          msg.className = 'notify-msg ok';
          this.reset();
        } else {
          msg.textContent = json.error || 'Something went wrong — please try again.';
          msg.className = 'notify-msg err';
        }
      } catch {
        msg.textContent = 'Something went wrong — please try again.';
        msg.className = 'notify-msg err';
      } finally {
        btn.disabled = false;
        btn.textContent = 'Notify me →';
      }
    });
  </script>
</body>
</html>`;

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (
    process.env.COMING_SOON === "true" &&
    !isBypassPath(pathname) &&
    !(await isAdminRequest(request))
  ) {
    // Absolute URLs for the OG/Twitter tags — Facebook etc. require them.
    const origin = request.nextUrl.origin;
    const html = HOLDING_HTML.replaceAll("__ORIGIN__", origin);
    return new NextResponse(html, {
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }

  return updateSession(request);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
