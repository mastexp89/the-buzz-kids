import Link from "next/link";
import Image from "next/image";
import { Caveat } from "next/font/google";
import { createClient } from "@/lib/supabase/server";
import TrackedLink from "@/components/TrackedLink";

// Handwritten accent for the illustration caption (same face as the homepage doodles).
const caveat = Caveat({ subsets: ["latin"], weight: ["700"], display: "swap" });

const EXPLORE = [
  { href: "/browse", label: "Places to go" },
  { href: "/browse?tab=events", label: "What's on" },
  { href: "/browse?tab=deals", label: "Deals" },
  { href: "/surprise", label: "Surprise me" },
  { href: "/list-your-activity", label: "List an activity" },
];

const ABOUT = [
  { href: "/about", label: "About The Buzz Kids" },
  { href: "/accessibility", label: "Sensory & Access" },
  { href: "/advertise", label: "Advertise" },
  { href: "/privacy", label: "Privacy" },
];

// Little Scottish hills scene: sun, birds, a castle on the hill, trees.
function HillsScene() {
  return (
    <svg viewBox="0 0 320 160" className="w-full h-auto block" role="img" aria-label="Rolling Scottish hills with a castle">
      <defs>
        <linearGradient id="bk-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#D8EEFB" />
          <stop offset="1" stopColor="#F2F9FE" />
        </linearGradient>
      </defs>
      <rect width="320" height="160" fill="url(#bk-sky)" />
      {/* sun + rays */}
      <g stroke="#FFD23F" strokeWidth="3" strokeLinecap="round">
        <line x1="262" y1="10" x2="262" y2="16" />
        <line x1="262" y1="60" x2="262" y2="66" />
        <line x1="234" y1="38" x2="240" y2="38" />
        <line x1="284" y1="38" x2="290" y2="38" />
        <line x1="242" y1="18" x2="246" y2="22" />
        <line x1="278" y1="54" x2="282" y2="58" />
        <line x1="282" y1="18" x2="278" y2="22" />
        <line x1="246" y1="54" x2="242" y2="58" />
      </g>
      <circle cx="262" cy="38" r="16" fill="#FFD23F" />
      {/* birds */}
      <g fill="none" stroke="#647682" strokeWidth="2" strokeLinecap="round">
        <path d="M40 34 q5 -5 10 0 q5 -5 10 0" />
        <path d="M70 22 q4 -4 8 0 q4 -4 8 0" />
      </g>
      {/* back hill */}
      <path d="M0 108 Q70 62 150 90 T320 82 V160 H0 Z" fill="#B9DF7A" />
      {/* castle */}
      <g fill="#8FA2B3">
        <rect x="150" y="58" width="14" height="36" />
        <rect x="192" y="58" width="14" height="36" />
        <rect x="162" y="66" width="32" height="28" />
        <rect x="150" y="52" width="4" height="7" /><rect x="155" y="52" width="4" height="7" /><rect x="160" y="52" width="4" height="7" />
        <rect x="192" y="52" width="4" height="7" /><rect x="197" y="52" width="4" height="7" /><rect x="202" y="52" width="4" height="7" />
        <rect x="164" y="60" width="4" height="7" /><rect x="172" y="60" width="4" height="7" /><rect x="180" y="60" width="4" height="7" /><rect x="188" y="60" width="4" height="7" />
      </g>
      <path d="M172 94 v-10 a6 6 0 0 1 12 0 v10 z" fill="#5B6B78" />
      <line x1="199" y1="52" x2="199" y2="38" stroke="#5B6B78" strokeWidth="2" />
      <path d="M199 38 l12 4 l-12 4 z" fill="#EC1E8C" />
      {/* middle hill */}
      <path d="M0 126 Q90 96 170 113 T320 104 V160 H0 Z" fill="#8CC63F" />
      {/* trees */}
      <g fill="#4E8F1E">
        <path d="M34 90 l13 26 h-26 z" /><path d="M56 98 l10 20 h-20 z" />
        <path d="M246 88 l13 26 h-26 z" /><path d="M268 96 l10 20 h-20 z" /><path d="M292 90 l12 24 h-24 z" />
      </g>
      <g fill="#7A5A3A">
        <rect x="32" y="116" width="4" height="6" /><rect x="54" y="118" width="4" height="5" />
        <rect x="244" y="114" width="4" height="6" /><rect x="266" y="116" width="4" height="5" /><rect x="290" y="114" width="4" height="6" />
      </g>
      {/* front hill */}
      <path d="M0 142 Q110 118 200 134 T320 128 V160 H0 Z" fill="#6FA713" />
    </svg>
  );
}

export default async function Footer() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  let role: string | null = null;
  if (user) {
    const { data: profile } = await supabase
      .from("profiles").select("role").eq("id", user.id).maybeSingle();
    role = profile?.role ?? null;
  }

  return (
    <footer className="mt-16 bg-buzz-bg">
      {/* Cross-promo to the grown-ups' sister site — on every page via the footer. */}
      <div className="border-y border-buzz-border bg-buzz-card">
        <div className="container-page py-4 flex flex-col sm:flex-row items-center justify-center gap-3 text-center text-sm">
          <span className="text-buzz-mute">
            Need a night off? <strong className="text-buzz-text">The Buzz Guide</strong>{" "}
            is our grown-ups' sister site — live music, nights out and events across Scotland.
          </span>
          <TrackedLink
            href="https://www.thebuzzguide.co.uk"
            kind="click_buzzguide"
            source="footer_banner"
            target="_blank"
            rel="noopener"
            className="btn-secondary !py-1.5 !px-4 whitespace-nowrap shrink-0"
          >
            Visit The Buzz Guide →
          </TrackedLink>
        </div>
      </div>

      <div className="container-page py-10 grid grid-cols-2 lg:grid-cols-[1.3fr_1fr_1fr_1.4fr] gap-x-6 gap-y-8 items-start">
        <div className="col-span-2 lg:col-span-1 flex flex-col items-start gap-3">
          <Link href="/" aria-label="The Buzz Kids — home">
            <Image src="/logo.png" alt="The Buzz Kids" width={99} height={80} className="h-20 w-auto" />
          </Link>
          <p className="text-sm text-buzz-mute font-semibold max-w-[16rem]">
            Things to do with the kids. Places to go. Memories to make — across Scotland.
          </p>
        </div>

        <nav aria-label="Explore">
          <h3 className="font-bold text-buzz-text mb-3">Explore</h3>
          <ul className="flex flex-col gap-2 text-sm">
            {EXPLORE.map((l) => (
              <li key={l.href + l.label}>
                <Link href={l.href} className="text-buzz-mute hover:text-buzz-accent transition">{l.label}</Link>
              </li>
            ))}
          </ul>
        </nav>

        <nav aria-label="About">
          <h3 className="font-bold text-buzz-text mb-3">About</h3>
          <ul className="flex flex-col gap-2 text-sm">
            {ABOUT.map((l) => (
              <li key={l.href}>
                <Link href={l.href} className="text-buzz-mute hover:text-buzz-accent transition">{l.label}</Link>
              </li>
            ))}
            {user && role === "admin" ? (
              <li><Link href="/admin" className="text-buzz-mute hover:text-buzz-accent transition">Admin</Link></li>
            ) : null}
          </ul>
        </nav>

        <div className="col-span-2 lg:col-span-1 relative">
          <span
            className={`${caveat.className} absolute -top-3 right-3 z-10 text-2xl leading-none text-right text-buzz-accent2 -rotate-3`}
          >
            Happier family<br />days in Scotland <span className="text-buzz-pink">♥</span>
          </span>
          <div className="rounded-3xl overflow-hidden border border-buzz-border shadow-[0_18px_40px_-28px_rgba(22,32,42,0.4)]">
            <HillsScene />
          </div>
        </div>
      </div>

      <div className="border-t border-buzz-border">
        <div className="container-page py-4 flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-buzz-mute text-center">
          <span>© {new Date().getFullYear()} The Buzz Kids · A sister site to{" "}
            <TrackedLink href="https://www.thebuzzguide.co.uk" kind="click_buzzguide" source="footer_credit" target="_blank" rel="noopener" className="text-buzz-accent hover:underline underline-offset-2">
              The Buzz Guide
            </TrackedLink>
          </span>
          <span>
            Made with <span className="text-buzz-pink">♥</span> for Scottish families · Designed by{" "}
            <a href="https://www.forthhost.com" target="_blank" rel="noopener" className="text-buzz-accent hover:underline underline-offset-2">
              Forth Host &amp; Web Design
            </a>
          </span>
        </div>
      </div>
    </footer>
  );
}
