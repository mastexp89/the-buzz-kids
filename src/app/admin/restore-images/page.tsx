import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import RunRestore from "./RunRestore";

export const dynamic = "force-dynamic";
export const maxDuration = 300;
export const metadata = { title: "Restore images — The Buzz Kids admin" };

export default async function RestoreImagesPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/admin/restore-images");
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
  let columnMissing = false;
  let todo = 0, withImage = 0, noWebsite = 0;

  const todoRes = await sb
    .from("venues").select("id", { count: "exact", head: true })
    .eq("approved", true).is("cover_photo_url", null)
    .is("image_restore_attempt", null).not("website", "is", null);
  if (todoRes.error) columnMissing = true;
  else todo = todoRes.count ?? 0;

  // sql/099 (provenance + licensing) is a separate migration.
  const provRes = await sb.from("venues").select("image_source").limit(1);
  const provenanceMissing = !!provRes.error;

  if (!columnMissing) {
    const { count: c1 } = await sb.from("venues").select("id", { count: "exact", head: true })
      .eq("approved", true).not("cover_photo_url", "is", null);
    withImage = c1 ?? 0;
    const { count: c2 } = await sb.from("venues").select("id", { count: "exact", head: true })
      .eq("approved", true).is("cover_photo_url", null).is("website", null);
    noWebsite = c2 ?? 0;
  }

  return (
    <div className="container-page py-10 max-w-3xl">
      <Link href="/admin" className="text-sm text-buzz-mute hover:text-buzz-accent transition">← Back to admin</Link>
      <p className="eyebrow mt-4 mb-1">Ops</p>
      <h1 className="h-display text-4xl sm:text-5xl mb-2">Restore images 🖼️</h1>
      <p className="text-buzz-mute mb-6 max-w-xl">
        Google blocked the photo links we had for venues, so they stopped loading. This re-hosts a picture from each
        venue&apos;s <strong>own website</strong> into our storage — permanent, ours, and it can&apos;t be blocked again.
        <strong> Free</strong> — no paid API.
      </p>

      {columnMissing ? (
        <div className="rounded-xl px-4 py-3 text-sm" style={{ background: "#FDECEC", color: "#a3282a" }}>
          ⚠ Run <code>sql/098_restore_venue_images.sql</code> in Supabase, then refresh.
        </div>
      ) : (
        <>
          <div className="flex gap-2 flex-wrap mb-4">
            <span className="text-xs rounded-full border border-buzz-border px-3 py-1">✅ Have an image: <strong>{withImage}</strong></span>
            <span className="text-xs rounded-full border border-buzz-border px-3 py-1">🔄 To try: <strong>{todo}</strong></span>
            <span className="text-xs rounded-full border border-buzz-border px-3 py-1">🚫 No website to try: <strong>{noWebsite}</strong></span>
          </div>

          {provenanceMissing && (
            <div className="rounded-xl px-4 py-3 text-sm mb-4" style={{ background: "#FFF6E5", color: "#8a5a00" }}>
              ⚠ Run <code>sql/099_image_provenance.sql</code> in Supabase to enable &ldquo;Swap to licensed photos&rdquo;
              (it stores each image&apos;s source, licence and required credit).
            </div>
          )}

          <div className="card p-4">
            <RunRestore startRemaining={todo} />
          </div>

          <p className="text-xs text-buzz-mute mt-4">
            Venues we can&apos;t find a picture for keep the tidy 🐝 placeholder rather than a broken image. The best
            long-term fix for those is the venue uploading their own photo via{" "}
            <Link href="/admin/suggestions" className="text-buzz-accent">suggestions</Link>.
          </p>
        </>
      )}
    </div>
  );
}
