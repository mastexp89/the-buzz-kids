import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { DEFAULT_DEAL_SOURCES } from "@/lib/deal-sweep";
import RunSweep from "./RunSweep";

export const dynamic = "force-dynamic";
// The AI reads each source page inside the sweep server action — give it the
// long budget the events importer uses.
export const maxDuration = 300;
export const metadata = { title: "Find deals — The Buzz Kids admin" };

export default async function FindDealsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/admin/find-deals");
  const { data: me } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (me?.role !== "admin") {
    return (
      <div className="container-page py-16 text-center">
        <h1 className="h-display text-3xl mb-2">Admins only</h1>
        <Link href="/admin" className="btn-secondary mt-6 inline-block">Back to admin</Link>
      </div>
    );
  }

  const sb = createServiceClient();
  const { count: pending } = await sb
    .from("offers").select("id", { count: "exact", head: true }).eq("approved", false);

  return (
    <div className="container-page py-10 max-w-3xl">
      <Link href="/admin" className="text-sm text-buzz-mute hover:text-buzz-accent transition">← Back to admin</Link>
      <p className="eyebrow mt-4 mb-1">Money savers</p>
      <h1 className="h-display text-4xl sm:text-5xl mb-2">Find deals 🔎</h1>
      <p className="text-buzz-mute mb-6 max-w-xl">
        Point the AI at &ldquo;kids eat free&rdquo; / family-days-out roundup pages and it drafts the deals it finds
        into your <Link href="/admin/offers" className="text-buzz-accent">review queue</Link> — deduped against what
        you already have. Nothing goes live until you approve it there.
        {pending ? <> You currently have <strong>{pending}</strong> awaiting review.</> : null}
      </p>

      <div className="card p-4">
        <RunSweep defaultUrls={DEFAULT_DEAL_SOURCES} />
      </div>

      <p className="text-xs text-buzz-mute mt-4">
        💡 Best for topping up <strong>national</strong> chain deals (especially seasonal school-holiday ones). For deals
        that also earn commission, the affiliate voucher feeds (Awin / Picniq) are the next step.
      </p>
    </div>
  );
}
