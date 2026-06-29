import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import DeleteAccountButton from "./DeleteAccountButton";

export const metadata = {
  title: "Delete your account — The Buzz Guide",
  description:
    "How to delete your The Buzz Guide account and request removal of your data.",
};

export const dynamic = "force-dynamic";

export default async function DeleteAccountPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const userEmail = user?.email ?? null;
  return (
    <div className="container-page py-12 max-w-3xl">
      <Link
        href="/"
        className="text-sm text-buzz-mute hover:text-buzz-accent transition"
      >
        ← Back to home
      </Link>

      <p className="eyebrow mt-3 mb-1">Account</p>
      <h1 className="h-display text-4xl sm:text-5xl mb-2">
        Delete your account
      </h1>
      <p className="text-buzz-mute mb-10">Last updated: 4 May 2026</p>

      <div className="prose-buzz space-y-8 text-buzz-text/90 leading-relaxed">
        <section>
          <p>
            This page explains how to delete your account on{" "}
            <strong>The Buzz Guide</strong> (operated by The Buzz Guide, Dundee,
            Scotland) and how to request that any associated data is removed.
          </p>
          <p>
            You can use either of the two methods below. Both are free and result
            in the same outcome.
          </p>
        </section>

        {userEmail ? (
          <section>
            <h2 className="font-display text-2xl uppercase mb-3 mt-6">
              Delete now
            </h2>
            <DeleteAccountButton userEmail={userEmail} />
            <p className="mt-3 text-sm text-buzz-mute">
              Or follow the manual instructions below if you'd rather email us.
            </p>
          </section>
        ) : (
          <section>
            <h2 className="font-display text-2xl uppercase mb-3 mt-6">
              Method 1 — Delete from inside the app or website
            </h2>
            <ol className="list-decimal pl-6 space-y-2">
              <li>
                Open The Buzz Guide on your phone (or sign in at{" "}
                <a
                  className="text-buzz-accent hover:text-buzz-accent2"
                  href="https://www.thebuzzguide.co.uk/login"
                >
                  thebuzzguide.co.uk
                </a>
                ).
              </li>
              <li>
                Go to the <strong>Account</strong> tab and sign in.
              </li>
              <li>
                Tap <strong>Account settings</strong>.
              </li>
              <li>
                Tap <strong>Delete account</strong> and confirm.
              </li>
            </ol>
            <p className="mt-3">
              Your account is deactivated immediately and your profile, venues,
              gigs and uploads are removed from our database within 30 days.
            </p>
          </section>
        )}

        <section>
          <h2 className="font-display text-2xl uppercase mb-3 mt-6">
            {userEmail ? "Or email us" : "Method 2 — Email us"}
          </h2>
          <p>
            Send an email from the address you signed up with to{" "}
            <a
              className="text-buzz-accent hover:text-buzz-accent2"
              href="mailto:hello@thebuzzkids.co.uk?subject=Delete%20my%20account"
            >
              hello@thebuzzkids.co.uk
            </a>{" "}
            with the subject line <em>"Delete my account"</em>.
          </p>
          <p className="mt-3">
            We will confirm receipt within 2 working days and complete the
            deletion within 30 days.
          </p>
        </section>

        <section>
          <h2 className="font-display text-2xl uppercase mb-3 mt-6">
            What gets deleted
          </h2>
          <ul className="list-disc pl-6 space-y-2 mt-2">
            <li>Your profile (email, display name, role).</li>
            <li>
              Any venues you own, plus their address, opening hours, social
              links and uploaded photos.
            </li>
            <li>
              All gigs you have created, including posters and tagged artists.
            </li>
            <li>Any artist page automatically created for you.</li>
            <li>Your authentication record with our auth provider, Supabase.</li>
          </ul>
        </section>

        <section>
          <h2 className="font-display text-2xl uppercase mb-3 mt-6">
            What we keep, and why
          </h2>
          <ul className="list-disc pl-6 space-y-2 mt-2">
            <li>
              <strong>Stripe transaction records</strong> — payment records for
              any venue subscription or promotion you purchased are retained by
              Stripe for the period required by UK financial regulations
              (typically 6 years). We retain only the Stripe transaction
              reference, the amount and the subscription status — not your card
              details.
            </li>
            <li>
              <strong>Anonymised event data</strong> — past gigs that took place
              before your account was deleted may remain visible as historical
              listings, with your venue or artist name replaced by "Removed
              venue" / "Removed artist". This is so historical search results
              and bookmarks do not break.
            </li>
            <li>
              <strong>Server logs</strong> — generic web server logs (IP
              addresses, request paths) are retained by our hosting provider
              Vercel for up to 30 days for security and abuse prevention.
            </li>
          </ul>
        </section>

        <section>
          <h2 className="font-display text-2xl uppercase mb-3 mt-6">
            Questions
          </h2>
          <p>
            Email{" "}
            <a
              className="text-buzz-accent hover:text-buzz-accent2"
              href="mailto:hello@thebuzzkids.co.uk"
            >
              hello@thebuzzkids.co.uk
            </a>{" "}
            and we will respond within 2 working days.
          </p>
        </section>

        <section>
          <p className="text-sm text-buzz-mute">
            See our{" "}
            <Link
              href="/privacy"
              className="text-buzz-accent hover:text-buzz-accent2"
            >
              Privacy Policy
            </Link>{" "}
            for full details on what data we collect and your rights under UK
            GDPR.
          </p>
        </section>
      </div>
    </div>
  );
}
