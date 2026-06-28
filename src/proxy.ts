import { NextResponse, type NextRequest } from "next/server";
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

const HOLDING_HTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>The Buzz Kids — Coming Soon</title>
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
    .areas {
      display: flex;
      flex-wrap: wrap;
      justify-content: center;
      gap: 0.5rem;
      margin-bottom: 0.75rem;
    }
    .pill {
      background: #fff;
      border: 1.5px solid #DCEAF3;
      border-radius: 9999px;
      padding: 0.4rem 1rem;
      font-size: 0.85rem;
      font-weight: 500;
      color: #16202A;
    }
    p.soon {
      font-size: 0.8rem;
      color: #647682;
      margin-bottom: 2.5rem;
    }
    a.cta {
      display: inline-block;
      background: #1FA9E0;
      color: #fff;
      font-weight: 600;
      font-size: 0.95rem;
      border-radius: 0.5rem;
      padding: 0.75rem 1.75rem;
      text-decoration: none;
      transition: opacity 0.15s;
    }
    a.cta:hover { opacity: 0.88; }
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
  <div class="areas">
    <span class="pill">📍 Dundee</span>
    <span class="pill">📍 Angus</span>
    <span class="pill">📍 Fife</span>
    <span class="pill">📍 Perth &amp; Perthshire</span>
  </div>
  <p class="soon">More areas to follow — Aberdeen, Edinburgh, Glasgow, Stirling and beyond.</p>
  <a class="cta" href="/signup?as=venue">
    List your place free — be first in the directory →
  </a>
  <footer>
    <div>A sister site to <a href="https://www.thebuzzguide.co.uk" style="color:#1FA9E0">The Buzz Guide</a>.</div>
    <div>Designed by <a href="https://www.forthhost.com" style="color:#EC1E8C">Forth Host &amp; Web Design</a>.</div>
  </footer>
</body>
</html>`;

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (process.env.COMING_SOON === "true" && !isBypassPath(pathname)) {
    return new NextResponse(HOLDING_HTML, {
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
