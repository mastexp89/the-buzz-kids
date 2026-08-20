import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import VenueFbIdsClient from "./VenueFbIdsClient";

export const dynamic = "force-dynamic";
export const metadata = { title: "Facebook Page IDs — The Buzz Kids admin" };

export default async function VenueFbIdsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/admin/venue-fb-ids");
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
  const probe = await sb.from("venues").select("facebook_page_id").limit(1);
  const columnMissing = !!probe.error;

  let initial: any[] = [];
  let taggable = 0;
  if (!columnMissing) {
    const { data } = await sb
      .from("venues")
      .select("id, name, facebook, facebook_page_id, city:cities(name)")
      .eq("approved", true)
      .not("facebook", "is", null)
      .order("name")
      .limit(40);
    initial = (data ?? []).map((v: any) => ({
      id: v.id, name: v.name, facebook: v.facebook,
      facebook_page_id: v.facebook_page_id, city: v.city?.name ?? null,
    }));
    const { count } = await sb
      .from("venues").select("id", { count: "exact", head: true })
      .not("facebook_page_id", "is", null);
    taggable = count ?? 0;
  }

  return (
    <div className="container-page py-10 max-w-3xl">
      <Link href="/admin" className="text-sm text-buzz-mute hover:text-buzz-accent transition">← Back to admin</Link>
      <p className="eyebrow mt-4 mb-1">Ops</p>
      <h1 className="h-display text-4xl sm:text-5xl mb-2">Facebook Page IDs 🔖</h1>
      <p className="text-buzz-mute mb-6 max-w-xl">
        The daily Facebook roundup can <strong>@-tag</strong> the places it features, which notifies them and makes a
        reshare far more likely. Tagging needs the Page&apos;s numeric ID — Facebook won&apos;t let us look those up
        automatically, so paste them here. <strong>{taggable}</strong> place{taggable === 1 ? "" : "s"} taggable so far.
      </p>

      {columnMissing ? (
        <div className="rounded-xl px-4 py-3 text-sm" style={{ background: "#FDECEC", color: "#a3282a" }}>
          ⚠ Run <code>sql/100_venue_facebook_page_id.sql</code> in Supabase, then refresh.
        </div>
      ) : (
        <>
          <div className="rounded-xl px-4 py-3 text-sm mb-5" style={{ background: "#E8F2FA", color: "#16202A" }}>
            <strong>How to find an ID:</strong> open the place&apos;s Facebook Page → <em>About</em> → scroll to
            &ldquo;Page transparency&rdquo; (the ID is a long number). Or paste any URL containing one. Posts still go
            out untagged if a place has no ID, so this is optional polish.
          </div>
          <VenueFbIdsClient initial={initial} />
        </>
      )}
    </div>
  );
}
