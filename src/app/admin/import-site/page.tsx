import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import ImportSiteClient from "./ImportSiteClient";

export const dynamic = "force-dynamic";
// Server action calls can take up to ~60s when scraping many detail pages.
export const maxDuration = 60;
export const metadata = { title: "Import from website — The Buzz Guide admin" };

export default async function ImportSitePage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: me } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (me?.role !== "admin") {
    return (
      <div className="container-page py-16 text-center">
        <h1 className="h-display text-3xl mb-2">Admins only</h1>
        <Link href="/dashboard" className="btn-secondary mt-6 inline-block">Back to dashboard</Link>
      </div>
    );
  }

  return (
    <div className="container-page py-10 max-w-5xl">
      <Link href="/admin" className="text-sm text-buzz-mute hover:text-buzz-accent transition">
        ← Back to admin
      </Link>
      <p className="eyebrow mt-3 mb-1">Admin</p>
      <h1 className="h-display text-4xl sm:text-5xl mb-2">🌐 Import from website</h1>
      <p className="text-buzz-mute mb-8 max-w-2xl">
        Paste an "upcoming events" page from a promoter / multi-venue site
        (e.g. a comedy club, ticketing aggregator) and we'll auto-discover
        each event. Or paste individual event URLs (one per line) for
        JavaScript-rendered sites where auto-discovery fails. Claude extracts
        venue + date/time + price + lineup and you map each event to the right
        venue before publishing.
      </p>
      <ImportSiteClient />
    </div>
  );
}
