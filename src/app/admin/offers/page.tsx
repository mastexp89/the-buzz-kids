import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import OffersAdminClient from "./OffersAdminClient";

export const dynamic = "force-dynamic";
export const metadata = { title: "Offers & deals — The Buzz Kids admin" };

export default async function OffersAdminPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/admin/offers");
  const { data: me } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (me?.role !== "admin") {
    return (
      <div className="container-page py-16 text-center">
        <h1 className="h-display text-3xl mb-2">Admins only</h1>
        <Link href="/admin" className="btn-secondary mt-6 inline-block">Back to admin</Link>
      </div>
    );
  }

  const [{ data: offers }, { data: cities }] = await Promise.all([
    supabase.from("offers").select("id, category, title, provider, terms, url, scope, city_id, approved, reports").order("category").order("sort_order"),
    supabase.from("cities").select("id, name, slug").order("name"),
  ]);

  return (
    <div className="container-page py-10 max-w-3xl">
      <Link href="/admin" className="text-sm text-buzz-mute hover:text-buzz-accent transition">← Back to admin</Link>
      <p className="eyebrow mt-4 mb-1">Money savers</p>
      <h1 className="h-display text-4xl sm:text-5xl mb-2">Offers &amp; deals</h1>
      <p className="text-buzz-mute mb-6 max-w-xl">
        Standing deals for families — "kids eat for £1", "kids go free" and so on. These are
        deal info only; they don't create place listings. They appear on the
        <strong className="text-buzz-text"> Deals</strong> and <strong className="text-buzz-text">Food</strong> tabs.
      </p>
      <OffersAdminClient offers={(offers ?? []) as any} cities={(cities ?? []) as any} />
    </div>
  );
}
