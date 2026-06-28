import Link from "next/link";

export const metadata = {
  title: "Privacy Policy — The Buzz Guide",
  description: "How The Buzz Guide collects, uses and protects your data.",
};

export default function PrivacyPage() {
  return (
    <div className="container-page py-12 max-w-3xl">
      <Link href="/" className="text-sm text-buzz-mute hover:text-buzz-accent transition">
        ← Back to home
      </Link>

      <p className="eyebrow mt-3 mb-1">Legal</p>
      <h1 className="h-display text-4xl sm:text-5xl mb-2">Privacy Policy</h1>
      <p className="text-buzz-mute mb-10">Last updated: 4 May 2026</p>

      <div className="prose-buzz space-y-6 text-buzz-text/90 leading-relaxed">
        <p>
          The Buzz Guide ("we", "us") operates the website <strong>thebuzzguide.co.uk</strong> and the
          accompanying mobile apps. This privacy policy explains what personal information we
          collect, how we use it, and the choices you have.
        </p>

        <section>
          <h2 className="font-display text-2xl uppercase mb-2 mt-6">Who runs The Buzz Guide</h2>
          <p>
            The Buzz Guide is operated from Dundee, Scotland. For privacy questions, email{" "}
            <a className="text-buzz-accent hover:text-buzz-accent2" href="mailto:admin@thebuzzguide.co.uk">
              admin@thebuzzguide.co.uk
            </a>.
          </p>
        </section>

        <section>
          <h2 className="font-display text-2xl uppercase mb-2 mt-6">What we collect</h2>
          <p>We only collect data that's needed to make the service work:</p>
          <ul className="list-disc pl-6 space-y-2 mt-2">
            <li>
              <strong>Account info</strong> — email address, display name, and password (passwords
              are stored encrypted by our auth provider, Supabase). For venue accounts, we also
              store the venue name, address, postcode, phone number, opening hours and social links
              you choose to provide.
            </li>
            <li>
              <strong>Content you upload</strong> — gig listings, venue photos, gig posters,
              artist tags. These are public on the website by design.
            </li>
            <li>
              <strong>Payment info</strong> — for venue subscriptions and promotions, payments
              are processed by Stripe. We do not see or store your card details — only Stripe's
              transaction reference, the amount and the subscription status.
            </li>
            <li>
              <strong>Approximate location</strong> — only if you tap "Near me" or pick "Sort by
              distance". We use this to calculate the distance between you and venues. Your
              location is never stored on our servers — it stays in your browser session and
              is cleared when you close the tab.
            </li>
            <li>
              <strong>Camera and photo library access</strong> — only when you choose to upload
              a logo, cover photo or gallery image. Photos you select are uploaded to our storage.
              We never read your camera or photo library without an explicit action from you.
            </li>
            <li>
              <strong>Basic usage logs</strong> — your IP address, browser, and pages visited,
              kept by our hosting provider Vercel for security and abuse prevention.
            </li>
          </ul>
        </section>

        <section>
          <h2 className="font-display text-2xl uppercase mb-2 mt-6">How we use it</h2>
          <ul className="list-disc pl-6 space-y-2 mt-2">
            <li>To run your account and let you sign in.</li>
            <li>To show your gigs, venue and artist pages publicly on The Buzz Guide.</li>
            <li>To send transactional emails — gig approval requests, password resets, signup confirmations, billing receipts.</li>
            <li>To process subscription and promotion payments via Stripe.</li>
            <li>To calculate distance to venues if you opt into "Near me".</li>
            <li>To investigate abuse, spam or technical issues.</li>
          </ul>
          <p className="mt-3">
            We <strong>do not</strong> sell your data, share it with advertisers, or use it for
            advertising. We <strong>do not</strong> show ads on the site.
          </p>
        </section>

        <section>
          <h2 className="font-display text-2xl uppercase mb-2 mt-6">Who we share data with</h2>
          <p>
            We use a small number of third-party services to operate The Buzz Guide. Each only sees the
            minimum data needed for their part of the system:
          </p>
          <ul className="list-disc pl-6 space-y-2 mt-2">
            <li><strong>Supabase</strong> — database, authentication and file storage.</li>
            <li><strong>Vercel</strong> — website and app hosting.</li>
            <li><strong>Stripe</strong> — venue subscription and promotion payments.</li>
            <li><strong>Resend</strong> — transactional email delivery.</li>
            <li><strong>postcodes.io</strong> — UK postcode → coordinates lookup for venue locations (no personal data sent).</li>
            <li><strong>OpenStreetMap</strong> — venue map tiles. Standard map tile requests include your IP, the same as any web mapping service.</li>
          </ul>
        </section>

        <section>
          <h2 className="font-display text-2xl uppercase mb-2 mt-6">Cookies and similar tech</h2>
          <p>
            We use a single first-party authentication cookie to keep you signed in. We don't use
            third-party tracking cookies or analytics that profile you. Stripe sets its own cookies
            during checkout for fraud prevention.
          </p>
        </section>

        <section>
          <h2 className="font-display text-2xl uppercase mb-2 mt-6">Your rights</h2>
          <p>
            Under UK GDPR you can ask us to:
          </p>
          <ul className="list-disc pl-6 space-y-2 mt-2">
            <li>Show you what personal data we hold about you.</li>
            <li>Correct anything that's wrong.</li>
            <li>Delete your account and associated data.</li>
            <li>Export your data in a portable format.</li>
            <li>Object to or restrict how we use your data.</li>
          </ul>
          <p className="mt-3">
            Email{" "}
            <a className="text-buzz-accent hover:text-buzz-accent2" href="mailto:admin@thebuzzguide.co.uk">
              admin@thebuzzguide.co.uk
            </a>{" "}
            and we'll handle it within 30 days. You can also delete your account directly from
            your account settings on the website.
          </p>
        </section>

        <section>
          <h2 className="font-display text-2xl uppercase mb-2 mt-6">Data retention</h2>
          <p>
            We keep your account data for as long as your account is active. When you delete your
            account, we delete your profile, venues, gigs and uploads from our database within
            30 days. Stripe retains transaction records as required by financial regulations.
          </p>
        </section>

        <section>
          <h2 className="font-display text-2xl uppercase mb-2 mt-6">Children</h2>
          <p>
            The Buzz Guide is not aimed at children under 13. We don't knowingly collect data from
            anyone under 13. If you believe we have, contact us and we'll delete it.
          </p>
        </section>

        <section>
          <h2 className="font-display text-2xl uppercase mb-2 mt-6">Mobile app permissions</h2>
          <p>
            The Buzz Guide mobile apps may request:
          </p>
          <ul className="list-disc pl-6 space-y-2 mt-2">
            <li>
              <strong>Photo library</strong> — to upload venue logos, cover photos and gallery
              images you choose.
            </li>
            <li>
              <strong>Camera</strong> — only if you choose to take a new photo for upload rather
              than selecting an existing one.
            </li>
            <li>
              <strong>Location</strong> — only when you tap "Near me" to see distance to venues.
              Location is not stored.
            </li>
          </ul>
          <p className="mt-3">
            All permissions are opt-in and only requested at the moment you use a feature that
            needs them.
          </p>
        </section>

        <section>
          <h2 className="font-display text-2xl uppercase mb-2 mt-6">Changes to this policy</h2>
          <p>
            If we make material changes we'll update the "Last updated" date and email account
            holders if the change affects them.
          </p>
        </section>

        <section>
          <h2 className="font-display text-2xl uppercase mb-2 mt-6">Contact</h2>
          <p>
            Questions, complaints, or to exercise any of your rights:{" "}
            <a className="text-buzz-accent hover:text-buzz-accent2" href="mailto:admin@thebuzzguide.co.uk">
              admin@thebuzzguide.co.uk
            </a>.
          </p>
        </section>
      </div>
    </div>
  );
}
