import Link from "next/link";
import { ACCESS_FACETS, ACCESS_QUESTIONS } from "@/lib/accessibility";

export const metadata = {
  title: "Sensory & Accessibility Guide — The Buzz Kids",
  description:
    "What our accessibility and sensory badges mean, and the questions worth asking a venue before you visit with a child who has additional needs.",
  alternates: { canonical: "/accessibility" },
};

export default function AccessibilityGuidePage() {
  return (
    <div className="container-page py-12 max-w-4xl">
      <div className="text-center mb-10">
        <span className="inline-block text-xs font-semibold rounded-full bg-buzz-surface border border-buzz-border px-3 py-1 mb-3">
          ✿ For every family
        </span>
        <h1 className="h-display text-4xl sm:text-5xl mb-2" style={{ color: "#3B6D11" }}>
          Sensory &amp; Accessibility Guide
        </h1>
        <p className="text-buzz-mute max-w-xl mx-auto">
          What our badges mean, and what to ask before you visit.
        </p>
      </div>

      {/* What the icons mean */}
      <section className="mb-12">
        <h2 className="font-display text-2xl uppercase mb-4 flex items-center gap-2">
          <span aria-hidden>✨</span> What the icons mean
        </h2>
        <div className="grid sm:grid-cols-2 gap-4">
          {ACCESS_FACETS.map((f) => (
            <div key={f.key} className="card p-5">
              <div className="flex items-center gap-3 mb-1.5">
                <span aria-hidden className="text-2xl leading-none">{f.icon}</span>
                <h3 className="font-semibold text-buzz-text">{f.label}</h3>
              </div>
              <p className="text-sm text-buzz-mute leading-relaxed">{f.desc}</p>
            </div>
          ))}
        </div>
        <p className="text-xs text-buzz-mute mt-3">
          We only show a badge when the venue has confirmed that feature. If a badge is missing it
          doesn't always mean "no" — it's worth a quick call to check.
        </p>
      </section>

      {/* Questions to ask */}
      <section className="mb-12">
        <h2 className="font-display text-2xl uppercase mb-2 flex items-center gap-2">
          <span aria-hidden>☎️</span> Questions to ask before you visit
        </h2>
        <p className="text-sm text-buzz-mute mb-4">
          A quick five-minute phone call (or email) can save a tough day. These are the questions
          we'd ask:
        </p>
        <ol className="flex flex-col gap-2">
          {ACCESS_QUESTIONS.map((q, i) => (
            <li key={i} className="card p-4 flex items-start gap-3">
              <span
                className="shrink-0 w-6 h-6 rounded-full grid place-items-center text-xs font-semibold"
                style={{ background: "#E6F6E0", color: "#3B6D11" }}
                aria-hidden
              >
                {i + 1}
              </span>
              <span className="text-sm text-buzz-text">{q}</span>
            </li>
          ))}
        </ol>
      </section>

      {/* Spotted something CTA */}
      <section
        className="rounded-3xl p-8 text-center text-white"
        style={{ background: "linear-gradient(135deg, #6FA713, #3B6D11)" }}
      >
        <h2 className="font-display text-2xl uppercase mb-2">Spotted something we should add?</h2>
        <p className="text-white/90 max-w-lg mx-auto mb-4">
          We rely on real parents to keep this info accurate. If a venue's details have changed,
          let us know and we'll update it.
        </p>
        <a
          href="mailto:hello@thebuzzkids.co.uk?subject=Accessibility%20update"
          className="inline-flex items-center gap-2 rounded-lg bg-white font-semibold px-5 py-2.5"
          style={{ color: "#3B6D11" }}
        >
          Tell us →
        </a>
      </section>

      <p className="text-center mt-8">
        <Link href="/" className="text-sm text-buzz-mute hover:text-buzz-accent transition">
          ← Back to home
        </Link>
      </p>
    </div>
  );
}
