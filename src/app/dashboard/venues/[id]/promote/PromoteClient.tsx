"use client";

export default function PromoteClient({ venue }: { venue: any; events: any[] }) {
  return (
    <div className="card p-8 text-center">
      <div className="text-4xl mb-3">🔦</div>
      <h2 className="h-display text-2xl mb-2">Spotlight your place</h2>
      <p className="text-buzz-mute max-w-md mx-auto text-sm">
        Want to be featured in the Spotlight carousel on the homepage? Get in touch and
        we'll sort it out for you.
      </p>
      <a
        href={`mailto:hello@thebuzzkids.co.uk?subject=Spotlight%20request%20for%20${encodeURIComponent(venue?.name ?? "my place")}`}
        className="btn-primary mt-6 inline-block"
      >
        Contact us about a spotlight →
      </a>
    </div>
  );
}
