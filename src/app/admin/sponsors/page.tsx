import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { listSponsors, listCitiesForForm } from "./actions";
import SponsorsListClient from "./SponsorsListClient";

export const dynamic = "force-dynamic";
export const metadata = { title: "Sponsors — The Buzz Guide admin" };

export default async function SponsorsAdminPage() {
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

  const [sponsors, cities] = await Promise.all([
    listSponsors(),
    listCitiesForForm(),
  ]);

  return (
    <div className="container-page py-10 max-w-5xl">
      <Link href="/admin" className="text-sm text-buzz-mute hover:text-buzz-accent transition">
        ← Back to admin
      </Link>
      <p className="eyebrow mt-3 mb-1">Admin</p>
      <h1 className="h-display text-4xl sm:text-5xl mb-2">💼 Sponsors</h1>
      <p className="text-buzz-mute mb-8 max-w-2xl">
        Third-party local businesses paying for ad slots — takeaways, taxis,
        hairdressers, etc. Separate from venue promotions (those go through
        Stripe). Sponsors are billed manually by bank transfer.
      </p>

      <SponsorsListClient initialSponsors={sponsors} cities={cities} />
    </div>
  );
}
