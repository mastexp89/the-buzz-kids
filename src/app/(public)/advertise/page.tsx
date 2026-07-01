import Link from "next/link";

export const metadata = {
  title: "Advertise on The Buzz Kids — reach local families planning their days out",
  description:
    "Put your brand in front of thousands of parents and carers planning days out across Scotland. Attractions, soft plays, family brands, days-out companies — get in touch.",
};

export default function AdvertisePage() {
  return (
    <div className="container-page py-12 sm:py-20 max-w-4xl">
      <div className="text-center mb-12">
        <p className="eyebrow mb-2">For family brands & businesses</p>
        <h1 className="h-display text-5xl sm:text-7xl mb-4">
          Reach the parents <span className="text-buzz-accent">planning the weekend.</span>
        </h1>
        <p className="text-buzz-mute max-w-xl mx-auto text-lg">
          The Buzz Kids is where families plan their days out. People scrolling our site are choosing
          where to take the kids this weekend or over the holidays. They're already ready to spend —
          your job is to be in front of them at the right moment.
        </p>
      </div>

      {/* Who's a fit */}
      <div className="card p-8 mb-8">
        <p className="eyebrow mb-2">Good fits</p>
        <h2 className="h-display text-2xl mb-4">If you sell to families, we're for you.</h2>
        <div className="grid sm:grid-cols-2 gap-y-2 gap-x-6 text-sm">
          {[
            "🎢 Attractions & days out",
            "🧸 Soft plays & play centres",
            "🍔 Family-friendly cafés & restaurants",
            "🎂 Party venues & entertainers",
            "🎨 Classes, clubs & workshops",
            "🚗 Family car & travel brands",
            "🛍️ Kids' clothing & toy brands",
            "🏕️ Holiday parks & family getaways",
          ].map((opt) => (
            <div key={opt}>{opt}</div>
          ))}
        </div>
      </div>

      {/* Options */}
      <div className="grid sm:grid-cols-2 gap-5 mb-8">
        <div className="card p-6">
          <p className="eyebrow mb-2">Spotlighted places</p>
          <h3 className="h-display text-2xl mb-2">Pin your place.</h3>
          <p className="text-sm text-buzz-mute">
            Lock a featured spot at the top of your area for a week. Best for an attraction or
            activity with something to push.
          </p>
        </div>
        <div className="card p-6">
          <p className="eyebrow mb-2">Banner placements</p>
          <h3 className="h-display text-2xl mb-2">Across the site.</h3>
          <p className="text-sm text-buzz-mute">
            Tasteful native ads on the home page, area pages and place pages. Targeted by activity
            type or by area if you want.
          </p>
        </div>
        <div className="card p-6">
          <p className="eyebrow mb-2">Sponsored content</p>
          <h3 className="h-display text-2xl mb-2">Branded picks.</h3>
          <p className="text-sm text-buzz-mute">
            "Brand X presents — three family days out to try this weekend." Editorial feel, clearly
            marked as sponsored.
          </p>
        </div>
        <div className="card p-6">
          <p className="eyebrow mb-2">Brand sponsorship</p>
          <h3 className="h-display text-2xl mb-2">Whole-site partnership.</h3>
          <p className="text-sm text-buzz-mute">
            "The Buzz Kids, in association with Brand X." Bigger commitment, exclusive in-category.
            Talk to us.
          </p>
        </div>
      </div>

      {/* CTA */}
      <div className="card p-8 sm:p-10 text-center bg-gradient-to-br from-buzz-accent/10 to-buzz-card border-buzz-accent/30">
        <p className="eyebrow mb-2">Get in touch</p>
        <h2 className="h-display text-3xl sm:text-4xl mb-3">Tell us about your business.</h2>
        <p className="text-buzz-mute max-w-md mx-auto mb-6">
          Drop us an email. We'll come back with audience numbers, where your ad would show, and
          what it'd cost.
        </p>
        <a
          href="mailto:hello@thebuzzkids.co.uk?subject=Advertising%20on%20The%20Buzz%20Kids"
          className="btn-primary btn-lg"
        >
          hello@thebuzzkids.co.uk
        </a>
      </div>

      <div className="text-center mt-10 text-sm text-buzz-mute">
        Run a venue?{" "}
        <Link href="/signup" className="text-buzz-accent hover:text-buzz-accent2">
          Listings are free →
        </Link>
      </div>
    </div>
  );
}
