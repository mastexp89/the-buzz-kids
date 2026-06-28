"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { recordSignup } from "./actions";

type AccountType = "venue" | "artist" | "organiser" | "fan";

const VALID_TYPES: AccountType[] = ["venue", "artist", "organiser", "fan"];

function SignupForm() {
  const router = useRouter();
  const params = useSearchParams();
  // ?as=artist, ?as=organiser, ?as=venue, ?as=fan — when set, skip the picker
  // and jump straight to the form. When absent, show the picker so users
  // explicitly choose before seeing any form fields (avoids the
  // "accidentally signed up as fan when I'm actually a venue" footgun).
  const urlType = params.get("as") as AccountType | null;
  const initialType: AccountType | null =
    urlType && VALID_TYPES.includes(urlType) ? urlType : null;
  const next = params.get("next");
  const [accountType, setAccountType] = useState<AccountType | null>(initialType);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    // The form is only rendered after a type is picked, so this should
    // never fire — but the early return narrows the type for TS so we
    // can pass accountType through to the actions below without a `!`.
    if (accountType === null) return;
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
          account_type: accountType,
        },
      },
    });

    if (error) {
      setLoading(false);
      setError(error.message);
      return;
    }

    // Fire-and-forget admin notification — don't block the redirect on it.
    recordSignup({
      displayName: name,
      email,
      accountType,
    }).catch(() => {});

    if (data.user && !data.session) {
      // Email verification required — soft nav is fine here, no auth cookie yet.
      // Pass the email through so /check-email can offer a "Resend" button
      // without asking the user to type their address again.
      router.replace(`/check-email?email=${encodeURIComponent(email)}`);
    } else {
      // Force full page nav so server picks up the new auth cookie immediately.
      // Each role has its own setup wizard so we don't create duplicate pages
      // for venues / artists that already exist in the directory.
      let dest = "/dashboard";
      if (accountType === "artist") {
        dest = "/dashboard/setup";
      } else if (accountType === "venue") {
        dest = "/dashboard/venue-setup";
      } else if (accountType === "organiser") {
        dest = next || "/dashboard/organiser-setup";
      } else if (accountType === "fan") {
        // Fans skip the setup wizard entirely — drop them on their
        // favourites page (or whatever "next" they were trying to reach
        // when they hit the signup wall).
        dest = next || "/dashboard/favourites";
      }
      window.location.assign(dest);
    }
  }

  // STEP 1 — picker. Shown when accountType is null (no ?as= param + nothing
  // clicked yet). User must pick an option before the form renders, so they
  // can't accidentally submit as "fan" when they really intended "venue".
  if (accountType === null) {
    return (
      <div className="max-w-lg mx-auto px-4 py-12">
        <p className="eyebrow mb-2">Create an account</p>
        <h1 className="h-display text-4xl mb-3">Welcome to The Buzz Guide</h1>
        <p className="text-buzz-mute mb-8">
          What are you signing up as? Pick one to continue.
        </p>

        <div className="flex flex-col gap-3">
          <TypeCard
            emoji="♡"
            title="Just a fan"
            tagline="Save your favourite venues, artists and gigs — we'll email you about new gigs and remind you on the day."
            onClick={() => setAccountType("fan")}
          />
          <TypeCard
            emoji="🐝"
            title="Venue"
            tagline="Claim or list your venue. Add events, manage your page, get followed by fans."
            onClick={() => setAccountType("venue")}
          />
          <TypeCard
            emoji="🎤"
            title="Artist / Band / DJ"
            tagline="Add gigs at any venue, link your socials, get discovered by local fans."
            onClick={() => setAccountType("artist")}
          />
          <TypeCard
            emoji="📋"
            title="Event organiser"
            tagline="Promote events across multiple venues. Festivals, club nights, comedy promoters."
            onClick={() => setAccountType("organiser")}
          />
        </div>

        <p className="text-sm text-buzz-mute text-center mt-8">
          Already have an account?{" "}
          <Link href="/login" className="text-buzz-accent">
            Sign in
          </Link>
        </p>
      </div>
    );
  }

  // STEP 2 — actual signup form. accountType is now guaranteed non-null.
  const isVenue = accountType === "venue";
  const isFan = accountType === "fan";

  const headline = isFan
    ? "Save the gigs you love."
    : isVenue
    ? "List your venue, free."
    : "Get your gigs heard.";

  const subline = isFan
    ? "Free account. Heart your favourite venues, artists and gigs — we'll email you when they post something new and remind you on the day."
    : isVenue
    ? "Free to list, free to manage gigs. Optional paid promotions if you want a boost."
    : "Free for artists, DJs and event organisers. Submit gigs at any venue on The Buzz Guide.";

  const typeLabel =
    accountType === "fan"
      ? "♡ Just a fan"
      : accountType === "venue"
      ? "🐝 Venue"
      : accountType === "artist"
      ? "🎤 Artist / Band / DJ"
      : "📋 Event organiser";

  return (
    <div className="max-w-md mx-auto px-4 py-12">
      <p className="eyebrow mb-2">Create an account</p>
      <h1 className="h-display text-4xl mb-2">{headline}</h1>
      <p className="text-buzz-mute mb-4">{subline}</p>

      {/* Current selection summary with "Change" link — replaces the old
          pill row. Keeping a single visible choice makes it unambiguous
          which account type the form below will submit as. */}
      <div className="flex items-center justify-between gap-3 mb-6 px-4 py-2 rounded-lg bg-buzz-card border border-buzz-border">
        <div className="text-sm">
          <span className="text-buzz-mute">Signing up as:</span>{" "}
          <strong className="text-buzz-accent">{typeLabel}</strong>
        </div>
        <button
          type="button"
          onClick={() => setAccountType(null)}
          className="text-xs text-buzz-mute hover:text-buzz-accent transition"
        >
          Change
        </button>
      </div>

      <form onSubmit={onSubmit} className="card p-6 flex flex-col gap-4">
        <div>
          <label className="label">Your name</label>
          <input
            className="input"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={
              isFan
                ? "Your first name"
                : isVenue
                ? "Alex Smith"
                : "Your stage / promoter name"
            }
          />
          <p className="help">
            {isFan
              ? "What should we call you? Just for emails — never shown publicly."
              : isVenue
              ? "Just your name — you'll set up the venue page on the next step."
              : "Your stage or promoter name."}
          </p>
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
    </div>
  );
}

// Large-card picker option used in step 1. Bigger and more deliberate than
// the old pill chips — harder to skip past, easier to read on mobile.
function TypeCard({
  emoji,
  title,
  tagline,
  onClick,
}: {
  emoji: string;
  title: string;
  tagline: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="text-left p-4 sm:p-5 rounded-xl bg-buzz-card border border-buzz-border hover:border-buzz-accent hover:bg-buzz-surface transition group flex items-start gap-4"
    >
      <span className="text-2xl shrink-0 leading-none mt-0.5" aria-hidden>
        {emoji}
      </span>
      <div className="flex-1 min-w-0">
        <div className="font-display text-lg uppercase tracking-wide group-hover:text-buzz-accent transition">
          {title}
        </div>
        <p className="text-sm text-buzz-mute mt-1 leading-snug">{tagline}</p>
      </div>
      <span
        className="shrink-0 text-buzz-mute group-hover:text-buzz-accent group-hover:translate-x-1 transition-all self-center"
        aria-hidden
      >
        →
      </span>
    </button>
  );
}

export default function SignupPage() {
  return (
    <Suspense fallback={<div className="max-w-md mx-auto px-4 py-12 text-buzz-mute">Loading…</div>}>
      <SignupForm />
    </Suspense>
  );
}
