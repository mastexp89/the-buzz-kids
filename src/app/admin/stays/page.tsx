import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { deleteStay, clearStaysForArea } from "./actions";
import RunStays from "./RunStays";

export const dynamic = "force-dynamic";
// The Apify searches run inside the "Import" server action on this route —
// give it the long budget the four concurrent runs need.
export const maxDuration = 300;
export const metadata = { title: "Places to stay — The Buzz Kids admin" };

const TYPE_LABEL: Record<string, string> = {
  glamping: "⛺ Glamping",
  caravan: "🚐 Caravan parks",
  cottage: "🏡 Cottages",
  hotel: "🏨 Hotels",
};
const TYPE_ORDER = ["glamping", "caravan", "cottage", "hotel"] as const;

export default async function StaysAdminPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/admin/stays");
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
  let tableMissing = false;
  let stays: any[] = [];
  const { data: cities } = await sb.from("cities").select("slug, name").order("name");
  const areas = (cities ?? []).map((c: any) => ({ slug: c.slug, name: c.name }));

  const sRes = await sb
    .from("stays")
    .select("id, name, stay_type, stay_types, city_slug, address, website, photo_url, google_rating, google_rating_count")
    .order("stay_type")
    .order("name")
    .limit(1000);
  if (sRes.error) tableMissing = true;
  else stays = sRes.data ?? [];

  // Group counts by area for the "clear area" control.
  const byArea = stays.reduce((a: Record<string, number>, s: any) => {
    a[s.city_slug] = (a[s.city_slug] || 0) + 1;
    return a;
  }, {});

  return (
    <div className="container-page py-10 max-w-3xl">
      <Link href="/admin" className="text-sm text-buzz-mute hover:text-buzz-accent transition">← Back to admin</Link>
      <p className="eyebrow mt-4 mb-1">Directory</p>
      <h1 className="h-display text-4xl sm:text-5xl mb-2">Places to stay 🛏️</h1>
      <p className="text-buzz-mute mb-6 max-w-xl">
        Pull family-friendly accommodation for an area from Google — glamping, caravan / holiday parks,
        self-catering cottages &amp; family hotels. Preview first (free), then import. Booking links come later.
      </p>

      {tableMissing ? (
        <div className="rounded-xl px-4 py-3 text-sm" style={{ background: "#FDECEC", color: "#a3282a" }}>
          ⚠ Run <code>sql/096_stays.sql</code> in Supabase, then refresh.
        </div>
      ) : (
        <>
          <div className="card p-4 mb-8">
            <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
              <div>
                <p className="text-sm font-medium">Import an area</p>
                <p className="text-xs text-buzz-mute">Preview is free · import uses the Google scraper (small £ cost).</p>
              </div>
              <span className="text-xs text-buzz-mute">{stays.length} stays saved</span>
            </div>
            <RunStays areas={areas} />
          </div>

          {TYPE_ORDER.map((t) => {
            const list = stays.filter((s) => s.stay_type === t);
            if (list.length === 0) return null;
            return (
              <section key={t} className="mb-8">
                <h2 className="font-display text-2xl mb-3">{TYPE_LABEL[t]} ({list.length})</h2>
                <div className="flex flex-col gap-2">
                  {list.map((s) => (
                    <div key={s.id} className="rounded-lg border border-buzz-border bg-buzz-card p-3 flex items-start gap-3">
                      {s.photo_url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={s.photo_url} alt="" className="w-14 h-14 rounded object-cover shrink-0" />
                      ) : (
                        <div className="w-14 h-14 rounded bg-buzz-bg shrink-0 grid place-items-center text-buzz-mute text-lg">🛏️</div>
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="font-medium truncate">
                          {s.name}
                          {Array.isArray(s.stay_types) && s.stay_types.filter((x: string) => x !== s.stay_type).map((x: string) => (
                            <span key={x} className="ml-1.5 text-[10px] align-middle rounded-full border border-buzz-border px-1.5 py-0.5 text-buzz-mute font-normal">+ {TYPE_LABEL[x]?.split(" ").slice(1).join(" ").toLowerCase() || x}</span>
                          ))}
                          {s.google_rating ? <span className="text-buzz-mute font-normal"> · ⭐{s.google_rating}{s.google_rating_count ? ` (${s.google_rating_count})` : ""}</span> : null}
                        </div>
                        <div className="text-[11px] text-buzz-mute truncate">
                          📍 {s.city_slug}{s.address ? ` · ${s.address}` : ""}
                        </div>
                        {s.website && (
                          <a href={s.website} target="_blank" rel="noopener" className="text-[11px] text-buzz-accent hover:underline break-all">{s.website.replace(/^https?:\/\//, "").replace(/\/$/, "")} ↗</a>
                        )}
                      </div>
                      <form action={deleteStay} className="shrink-0">
                        <input type="hidden" name="id" value={s.id} />
                        <button className="text-xs text-buzz-mute hover:text-red-600 px-1" title="Delete">Delete</button>
                      </form>
                    </div>
                  ))}
                </div>
              </section>
            );
          })}

          {stays.length === 0 && (
            <p className="text-sm text-buzz-mute">No stays yet — pick an area above and import.</p>
          )}

          {Object.keys(byArea).length > 0 && (
            <section className="mt-10 border-t border-buzz-border pt-5">
              <h2 className="font-display text-lg mb-2">Clear an area</h2>
              <p className="text-xs text-buzz-mute mb-3">Delete every stay for one region (e.g. to re-import cleanly).</p>
              <div className="flex flex-wrap gap-2">
                {Object.entries(byArea).map(([slug, n]) => (
                  <form key={slug} action={clearStaysForArea}>
                    <input type="hidden" name="city_slug" value={slug} />
                    <button className="text-xs rounded-full border border-buzz-border px-3 py-1 text-buzz-mute hover:border-red-500 hover:text-red-600">
                      {slug} ({n as number}) ✕
                    </button>
                  </form>
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}
