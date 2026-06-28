// Public sponsor profile page — what the Premium tier specifically pays for.
// Single-business deep page with logo, slogan, city, category, click-through.

import { notFound } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const supabase = await createClient();
  const { data: sponsor } = await supabase
    .from("sponsors")
    .select("name, blurb")
    .eq("slug", slug)
    .maybeSingle();
  if (!sponsor) return { title: "Not found" };
  return {
    title: `${sponsor.name} — The Buzz Guide`,
    description: sponsor.blurb ?? `${sponsor.name} on The Buzz Guide.`,
  };
}

export default async function SponsorProfilePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const supabase = await createClient();
  const nowIso = new Date().toISOString();

  const { data: sponsor } = await supabase
    .from("sponsors")
    .select(
      "id, name, slug, tier, image_url, link_url, blurb, category, status, starts_at, ends_at, city:cities(name, slug)",
    )
    .eq("slug", slug)
    .eq("status", "active")
    .lte("starts_at", nowIso)
    .gte("ends_at", nowIso)
    .maybeSingle();

  if (!sponsor) notFound();

  return (
    <div className="container-page py-10 sm:py-14 max-w-3xl">
      <Link href="/sponsors" className="text-sm text-buzz-mute hover:text-buzz-accent transition">
        ← All sponsors
      </Link>

      <div className="mt-4 card p-6 sm:p-10">
        <div className="flex items-start gap-6 flex-wrap">
          {sponsor.image_url ? (
            <div
              className="w-40 h-28 rounded-xl shrink-0 bg-black border border-buzz-border"
              style={{
                backgroundImage: `url(${sponsor.image_url})`,
                backgroundSize: "contain",
                backgroundPosition: "center",
                backgroundRepeat: "no-repeat",
              }}
            />
          ) : (
            <div className="w-40 h-28 rounded-xl bg-buzz-surface border border-buzz-border grid place-items-center text-4xl shrink-0">
              💼
            </div>
          )}
          <div className="min-w-0 flex-1">
            <p className="eyebrow mb-1 text-buzz-accent">Sponsored</p>
            <h1 className="h-display text-3xl sm:text-4xl mb-1">{sponsor.name}</h1>
            <div className="text-xs text-buzz-mute uppercase tracking-wider">
              {(sponsor.city as any)?.name ?? "Nationwide"}
              {sponsor.category ? ` · ${sponsor.category}` : ""}
            </div>
            {sponsor.blurb && (
              <p className="text-lg text-buzz-mute mt-3 italic">"{sponsor.blurb}"</p>
            )}
          </div>
        </div>

        <div className="mt-8">
          <a
            href={`/api/sponsor-click/${sponsor.id}`}
            target="_blank"
            rel="noopener sponsored"
            className="btn-primary btn-lg inline-flex items-center gap-2"
          >
            Visit {sponsor.name} →
          </a>
        </div>
      </div>

      <p className="text-xs text-buzz-mute mt-6 max-w-xl">
        {sponsor.name} is a paid sponsor of The Buzz Guide. Sponsorships keep the
        listings free for venues, artists, and event organisers. Want to advertise?{" "}
        <Link href="/advertise" className="text-buzz-accent hover:underline">
          See packages →
        </Link>
      </p>
    </div>
  );
}
