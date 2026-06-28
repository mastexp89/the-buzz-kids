import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import LeadsClient from "./LeadsClient";
import { LEAD_CATEGORIES } from "./categories";

export const dynamic = "force-dynamic";
// Vercel's default function timeout (10s Hobby, 60s Pro) is too short for a
// real Apify sweep — a single category against Angus can run for 90-180s.
// Bumping to 5 minutes; harmless if your plan caps it lower (Vercel just
// falls back to the plan max).
export const maxDuration = 300;
export const metadata = { title: "Lead generator — The Buzz Guide admin" };

export default async function LeadsAdminPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: me } = await supabase
    .from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (me?.role !== "admin") {
    return (
      <div className="container-page py-16 text-center">
        <h1 className="h-display text-3xl mb-2">Admins only</h1>
        <Link href="/dashboard" className="btn-secondary mt-6 inline-block">Back to dashboard</Link>
      </div>
    );
  }

  const { data: cities } = await supabase
    .from("cities")
    .select("id, name, slug")
    .order("name");

  return (
    <div className="container-page py-10 max-w-5xl">
      <Link href="/admin" className="text-sm text-buzz-mute hover:text-buzz-accent transition">
        ← Back to admin
      </Link>
      <p className="eyebrow mt-3 mb-1">Admin</p>
      <h1 className="h-display text-4xl sm:text-5xl mb-2">🎯 Lead generator</h1>
      <p className="text-buzz-mute mb-6 max-w-2xl">
        Pull a list of local businesses for outreach (advertising sales).
        Pick a city, pick a category, run — each run uses Apify Google Maps
        (~£0.20–£0.50 depending on category) and tries to scrape an email
        from each business's website. Download as CSV.
      </p>

      <div className="card p-4 mb-8 text-xs text-buzz-mute">
        <strong className="text-buzz-text">💷 Cost note:</strong> Apify charges
        about $0.002 per result. A full category sweep returns ~30-75 results
        depending on category, so each category costs $0.06-$0.15.
        Running all 8 categories per city ≈ $0.50-$1.20. Budget accordingly.
      </div>

      <LeadsClient
        cities={(cities ?? []) as any}
        categories={LEAD_CATEGORIES.map((c) => ({
          slug: c.slug,
          label: c.label,
          emoji: c.emoji,
        }))}
      />
    </div>
  );
}
