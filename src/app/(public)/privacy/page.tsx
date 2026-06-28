import Link from "next/link";

export const metadata = {
  title: "Privacy Policy & Disclaimer — The Buzz Kids",
  description:
    "How The Buzz Kids collects, uses and protects your data — and important information about the activities and venues we list.",
};

export default function PrivacyPage() {
  return (
    <div className="container-page py-12 max-w-3xl">
      <Link href="/" className="text-sm text-buzz-mute hover:text-buzz-accent transition">
        ← Back to home
      </Link>

      <p className="eyebrow mt-3 mb-1">Legal</p>
      <h1 className="h-display text-4xl sm:text-5xl mb-2">Privacy Policy &amp; Disclaimer</h1>
      <p className="text-buzz-mute mb-10">Last updated: 28 June 2026</p>

      <div className="prose-buzz space-y-6 text-buzz-text/90 leading-relaxed">
        <p>
          The Buzz Kids ("we", "us") operates the website <strong>thebuzzkids.co.uk</strong>, a
          directory of kid-friendly things to do — soft play, holiday clubs, farms, kids' theatre,
          classes, camps and family days out. This policy explains what personal information we
          collect and how we use it, and sets out important information about the listings on the site.
        </p>

        {/* Disclaimer first — the most important thing for a third-party listings site. */}
        <section className="rounded-2xl border border-buzz-accent/40 bg-buzz-card p-6">
          <h2 className="font-display text-2xl uppercase mb-2">About the activities and venues we list</h2>
          <p>
            The Buzz Kids is a <strong>listings and directory service</strong>. We do{" "}
            <strong>not</strong> own, run, organise, staff or operate any of the activities, events,
            classes, camps, venues or attractions listed on the site.
          </p>
          <ul className="list-disc pl-6 space-y-2 mt-3">
            <li>
              Listings are submitted by the organisers themselves, or gathered from publicly
              available sources such as Facebook pages and websites. They may be incomplete, out of
              date, or inaccurate.
            </li>
            <li>
              Prices, times, dates, age suitability, accessibility details and availability can
              change at any time. <strong>Always check directly with the organiser or venue before
              you travel, book or pay.</strong>
            </li>
            <li>
              We are not responsible for the quality, safety, accuracy, conduct, cancellation or
              your experience of any activity or venue listed, and accept no liability for any loss,
              cost, disappointment or harm arising from your use of, or reliance on, a listing.
            </li>
            <li>
              Any booking, payment or agreement is strictly between you and the organiser or venue.
            </li>
            <li>
              Reviews are the personal opinions of the parents and carers who wrote them — not ours.
              We moderate reviews but do not verify the claims in them.
            </li>
          </ul>
          <p className="mt-3 text-sm text-buzz-mute">
            If a listing is wrong, out of date, or shouldn't be here, please let us know at{" "}
            <a className="text-buzz-accent hover:text-buzz-accent2" href="mailto:hello@thebuzzkids.co.uk">
              hello@thebuzzkids.co.uk
            </a>{" "}
            and we'll review it.
          </p>
        </section>

        <section>
          <h2 className="font-display text-2xl uppercase mb-2 mt-6">Who runs The Buzz Kids</h2>
          <p>
            The Buzz Kids is operated from Scotland and is a sister site to The Buzz Guide. For
            privacy questions, email{" "}
            <a className="text-buzz-accent hover:text-buzz-accent2" href="mailto:hello@thebuzzkids.co.uk">
              hello@thebuzzkids.co.uk
            </a>.
          </p>
        </section>

        <section>
          <h2 className="font-display text-2xl uppercase mb-2 mt-6">What we collect</h2>
          <p>We only collect data that's needed to make the service work:</p>
          <ul className="list-disc pl-6 space-y-2 mt-2">
            <li>
              <strong>Account info</strong> — email address, display name, and password (passwords
              are stored encrypted by our authentication provider). For organiser accounts, we also
              store the details you choose to provide about your activity or venue (name, address,
              postcode, phone, opening hours, prices and links).
            </li>
            <li>
              <strong>Content you upload</strong> — activity and venue listings, photos, posters,
              your profile photo, and reviews (including any review photos). This content is public
              on the website by design.
            </li>
            <li>
              <strong>Reviews</strong> — the star rating, text and photos you submit. Your display
              name and profile photo are shown alongside approved reviews.
            </li>
            <li>
              <strong>Approximate location</strong> — only if you tap "Near me" or sort by distance.
              We use it to calculate distance to venues. It stays in your browser and is never stored
              on our servers.
            </li>
            <li>
              <strong>Camera and photo access</strong> — only when you choose to upload a profile
              photo, listing image or review photo. We never access your camera or photo library
              without an explicit action from you.
            </li>
            <li>
              <strong>Basic usage logs</strong> — IP address, browser and pages visited, kept by our
              hosting provider for security and abuse prevention.
            </li>
          </ul>
        </section>

        <section>
          <h2 className="font-display text-2xl uppercase mb-2 mt-6">How we use it</h2>
          <ul className="list-disc pl-6 space-y-2 mt-2">
            <li>To run your account and let you sign in.</li>
            <li>To show organiser listings, and approved reviews, publicly on the site.</li>
            <li>To let you save places to your bucket list and plan days out.</li>
            <li>To send transactional emails — listing approvals, password resets, signup confirmations.</li>
            <li>To calculate distance to venues if you opt into "Near me".</li>
            <li>To moderate reviews and investigate abuse, spam or technical issues.</li>
          </ul>
          <p className="mt-3">
            We <strong>do not</strong> sell your data, share it with advertisers, or use it for
            advertising profiling.
          </p>
        </section>

        <section>
          <h2 className="font-display text-2xl uppercase mb-2 mt-6">Who we share data with</h2>
          <p>
            We use a small number of trusted third-party providers to operate the site. Each only
            sees the minimum data needed for their part of the system:
          </p>
          <ul className="list-disc pl-6 space-y-2 mt-2">
            <li><strong>Cloud database, authentication and file storage</strong> — securely holds your account, listings and uploads.</li>
            <li><strong>Website hosting</strong> — serves the site and keeps short security and abuse-prevention logs.</li>
            <li><strong>Email delivery</strong> — sends transactional emails such as sign-up confirmations and password resets.</li>
            <li><strong>Postcode lookup</strong> — converts UK postcodes to map coordinates for venue locations (no personal data sent).</li>
            <li><strong>Map tiles</strong> — displays venue maps; tile requests include your IP, the same as any web map.</li>
          </ul>
          <p className="mt-3">
            Our providers operate under appropriate data-protection safeguards. If you'd like to know
            exactly which companies we use, just email us and we'll tell you.
          </p>
        </section>

        <section>
          <h2 className="font-display text-2xl uppercase mb-2 mt-6">Reviews</h2>
          <p>
            Parents and carers can leave reviews of places they've visited. Reviews are checked by us
            before they appear, and we may decline or remove any review — for example if it's abusive,
            off-topic, fake, or identifies a child. A review is one person's opinion and does not
            reflect the views of The Buzz Kids. If you're an organiser and believe a review is unfair
            or untrue, contact us and we'll look into it.
          </p>
        </section>

        <section>
          <h2 className="font-display text-2xl uppercase mb-2 mt-6">Cookies</h2>
          <p>
            We use a single first-party authentication cookie to keep you signed in. We don't use
            third-party tracking cookies that profile you.
          </p>
        </section>

        <section>
          <h2 className="font-display text-2xl uppercase mb-2 mt-6">Your rights</h2>
          <p>Under UK GDPR you can ask us to:</p>
          <ul className="list-disc pl-6 space-y-2 mt-2">
            <li>Show you what personal data we hold about you.</li>
            <li>Correct anything that's wrong.</li>
            <li>Delete your account and associated data.</li>
            <li>Export your data in a portable format.</li>
            <li>Object to or restrict how we use your data.</li>
          </ul>
          <p className="mt-3">
            Email{" "}
            <a className="text-buzz-accent hover:text-buzz-accent2" href="mailto:hello@thebuzzkids.co.uk">
              hello@thebuzzkids.co.uk
            </a>{" "}
            and we'll handle it within 30 days. You can also delete your account directly from your
            account settings.
          </p>
        </section>

        <section>
          <h2 className="font-display text-2xl uppercase mb-2 mt-6">Data retention</h2>
          <p>
            We keep your account data while your account is active. When you delete your account, we
            delete your profile, listings, reviews and uploads within 30 days.
          </p>
        </section>

        <section>
          <h2 className="font-display text-2xl uppercase mb-2 mt-6">Children</h2>
          <p>
            The Buzz Kids is a service for <strong>parents and carers</strong> (adults) to find
            things to do with children. Accounts are for adults only — it is not aimed at, and should
            not be used by, children under 16. We don't knowingly collect personal data from
            children. Please don't include identifying information about a child in reviews or photos.
            If you believe we hold a child's data, contact us and we'll delete it.
          </p>
        </section>

        <section>
          <h2 className="font-display text-2xl uppercase mb-2 mt-6">Changes to this policy</h2>
          <p>
            If we make material changes we'll update the "Last updated" date and email account holders
            if the change affects them.
          </p>
        </section>

        <section>
          <h2 className="font-display text-2xl uppercase mb-2 mt-6">Contact</h2>
          <p>
            Questions, complaints, or to exercise any of your rights:{" "}
            <a className="text-buzz-accent hover:text-buzz-accent2" href="mailto:hello@thebuzzkids.co.uk">
              hello@thebuzzkids.co.uk
            </a>.
          </p>
        </section>
      </div>
    </div>
  );
}
