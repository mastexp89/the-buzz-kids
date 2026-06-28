import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import SponsorOutreachClient, { type SavedLead, type CityOption } from "./SponsorOutreachClient";
import { BUSINESS_TYPE_PRESETS } from "./constants";

export const dynamic = "force-dynamic";
export const metadata = { title: "Sponsor outreach — The Buzz Guide admin" };

export default async function SponsorOutreachPage() {
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

  const sb = createServiceClient();
  // Load every saved lead + the cities the admin can search in. Cities
  // are anything in the `cities` table — including inactive — because
  // outreach often happens in areas where the public site isn't live yet.
  const [{ data: leadRows }, { data: cityRows }] = await Promise.all([
    sb
      .from("sponsor_outreach_leads")
      .select("id, name, fb_url, business_type, city_slug, description, notes, contacted_at, created_at")
      .order("created_at", { ascending: false })
      .limit(500),
    sb.from("cities").select("name, slug, active").order("name"),
  ]);

  const leads: SavedLead[] = (leadRows ?? []).map((l: any) => ({
    id: l.id,
    name: l.name,
    fbUrl: l.fb_url,
    businessType: l.business_type ?? null,
    citySlug: l.city_slug ?? null,
    description: l.description ?? null,
    notes: l.notes ?? null,
    contactedAt: l.contacted_at,
    createdAt: l.created_at,
  }));

  const cities: CityOption[] = (cityRows ?? []).map((c: any) => ({
    name: c.name,
    slug: c.slug,
    active: !!c.active,
  }));

  const braveConfigured = !!process.env.BRAVE_SEARCH_API_KEY;

  return (
    <div className="container-page py-10 max-w-5xl">
      <Link href="/admin" className="text-sm text-buzz-mute hover:text-buzz-accent transition">
        ← Back to admin
      </Link>
      <p className="eyebrow mt-3 mb-1">Admin</p>
      <h1 className="h-display text-4xl sm:text-5xl mb-2">💈 Sponsor outreach</h1>
      <p className="text-buzz-mute mb-6 max-w-2xl">
        Find local independents — hairdressers, barbers, beauty salons, tattoo
        studios — on Facebook by city, save the ones worth contacting, then
        DM them about sponsoring The Buzz Guide. Tick them off as you go so a
        re-search doesn&apos;t resurface what you&apos;ve already done.
      </p>
      {!braveConfigured && (
        <div className="card p-4 mb-6 border-amber-500/40 bg-amber-500/5">
          <p className="text-sm">
            <strong className="text-amber-400">Brave Search isn&apos;t configured.</strong>{" "}
            Set <code className="text-buzz-accent">BRAVE_SEARCH_API_KEY</code> in Vercel
            and redeploy. Sign up at{" "}
            <a href="https://brave.com/search/api/" target="_blank" rel="noreferrer" className="underline">
              brave.com/search/api
            </a>{" "}
            — the free tier covers 2,000 queries/month, ample for this tool.
          </p>
        </div>
      )}
      <SponsorOutreachClient
        initialLeads={leads}
        cities={cities}
        businessTypes={Array.from(BUSINESS_TYPE_PRESETS)}
        braveConfigured={braveConfigured}
      />
    </div>
  );
}
