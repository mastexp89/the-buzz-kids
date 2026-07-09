import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { expandSlices, type WheelPrize } from "@/lib/wheel";
import { updateWheelConfig, upsertPrize, deletePrize, setSpinFulfilled } from "./actions";
import DrawButtons from "./DrawButtons";

export const dynamic = "force-dynamic";
export const metadata = { title: "Lucky wheel — The Buzz Kids admin" };

export default async function WheelAdminPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/admin/wheel");
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
  let tablesMissing = false;
  let cfg: any = null;
  let prizes: WheelPrize[] = [];
  let totalSpins = 0;
  let confirmedCount = 0;
  let entryTally: Record<string, number> = {};
  let realWins: any[] = [];

  try {
    const cfgRes = await sb.from("wheel_config").select("*").eq("id", 1).maybeSingle();
    if (cfgRes.error) throw cfgRes.error;
    cfg = cfgRes.data;
    const { data: pr } = await sb.from("wheel_prizes").select("id, label, kind, slots, color, sort, active").order("sort");
    prizes = (pr ?? []) as WheelPrize[];

    const { count: spinCount } = await sb.from("wheel_spins").select("id", { count: "exact", head: true });
    totalSpins = spinCount ?? 0;
    const { count: cCount } = await sb.from("notify_signups").select("email", { count: "exact", head: true }).eq("confirmed", true);
    confirmedCount = cCount ?? 0;

    // Confirmed entries per draw-label.
    const { data: confirmed } = await sb.from("notify_signups").select("email").eq("confirmed", true);
    const okEmails = new Set((confirmed ?? []).map((c) => c.email));
    const { data: entrySpins } = await sb.from("wheel_spins").select("email, prize_label").eq("prize_kind", "entry");
    for (const s of entrySpins ?? []) {
      if (okEmails.has(s.email)) entryTally[s.prize_label] = (entryTally[s.prize_label] ?? 0) + 1;
    }

    const { data: rw } = await sb
      .from("wheel_spins").select("id, email, prize_label, spun_on, fulfilled")
      .eq("prize_kind", "real").order("created_at", { ascending: false }).limit(200);
    realWins = rw ?? [];
  } catch {
    tablesMissing = true;
  }

  const slices = expandSlices(prizes.filter((p) => p.active) as WheelPrize[]);
  const entryLabels = prizes.filter((p) => p.kind === "entry" && p.active).map((p) => p.label);

  return (
    <div className="container-page py-10 max-w-3xl">
      <Link href="/admin" className="text-sm text-buzz-mute hover:text-buzz-accent transition">← Back to admin</Link>
      <p className="eyebrow mt-4 mb-1">Marketing</p>
      <h1 className="h-display text-4xl sm:text-5xl mb-2">Lucky wheel 🎡</h1>
      <p className="text-buzz-mute mb-8 max-w-xl">
        Email-capture prize wheel at <code>/win</code>. It only goes live when <strong>Active</strong> is ticked below —
        nothing links to it on the site until you&apos;re ready to share the link.
      </p>

      {tablesMissing && (
        <div className="rounded-xl px-4 py-3 mb-8 text-sm" style={{ background: "#FDECEC", color: "#a3282a" }}>
          ⚠ The wheel tables don&apos;t exist yet. Run <code>sql/090_lucky_wheel.sql</code> in the Supabase SQL editor, then refresh this page.
        </div>
      )}

      {!tablesMissing && (
        <>
          {/* Status + stats */}
          <div className="grid grid-cols-3 gap-3 mb-8">
            {[
              { label: "Status", value: cfg?.active ? "🟢 Live" : "⚪ Off" },
              { label: "Total spins", value: totalSpins },
              { label: "Confirmed emails", value: confirmedCount },
            ].map((s) => (
              <div key={s.label} className="rounded-xl bg-buzz-card border border-buzz-border p-4">
                <p className="text-xs text-buzz-mute">{s.label}</p>
                <p className="text-2xl font-bold mt-1">{s.value}</p>
              </div>
            ))}
          </div>

          {/* Campaign config */}
          <section className="mb-10">
            <h2 className="font-display text-2xl mb-3">This month&apos;s campaign</h2>
            <form action={updateWheelConfig} className="rounded-xl border border-buzz-border bg-buzz-card p-4 flex flex-col gap-3">
              <label className="text-sm">
                <span className="block text-buzz-mute mb-1">Grand prize (shows as “Win …”)</span>
                <input name="grand_prize" defaultValue={cfg?.grand_prize ?? ""} className="w-full h-10 rounded-lg border border-buzz-border bg-buzz-bg px-3" />
              </label>
              <label className="text-sm">
                <span className="block text-buzz-mute mb-1">Blurb</span>
                <textarea name="grand_detail" defaultValue={cfg?.grand_detail ?? ""} rows={2} className="w-full rounded-lg border border-buzz-border bg-buzz-bg px-3 py-2" />
              </label>
              <div className="flex gap-4 items-center flex-wrap">
                <label className="text-sm">
                  <span className="block text-buzz-mute mb-1">Draw closes</span>
                  <input type="date" name="closes_on" defaultValue={cfg?.closes_on ?? ""} className="h-10 rounded-lg border border-buzz-border bg-buzz-bg px-3" />
                </label>
                <label className="flex items-center gap-2 text-sm font-medium mt-5">
                  <input type="checkbox" name="active" defaultChecked={!!cfg?.active} />
                  Active (live at /win)
                </label>
              </div>
              <button className="btn-primary self-start">Save campaign</button>
            </form>
          </section>

          {/* Prizes */}
          <section className="mb-10">
            <h2 className="font-display text-2xl mb-1">Wheel slices</h2>
            <p className="text-sm text-buzz-mute mb-3">
              {slices.length} slices in play. <strong>Slots</strong> = how many slices a prize takes (its odds). Higher slots on the
              draw-entry prizes keeps entries more likely than real prizes.
            </p>
            <div className="flex flex-col gap-2 mb-4">
              {prizes.map((p) => (
                <form key={p.id} action={upsertPrize} className="rounded-lg border border-buzz-border bg-buzz-card p-3 grid gap-2" style={{ gridTemplateColumns: "1fr auto" }}>
                  <input type="hidden" name="id" value={p.id} />
                  <div className="flex flex-wrap gap-2 items-center">
                    <span className="inline-block w-4 h-4 rounded-full shrink-0" style={{ background: p.color }} />
                    <input name="label" defaultValue={p.label} className="flex-1 min-w-[140px] h-9 rounded-lg border border-buzz-border bg-buzz-bg px-2 text-sm" />
                    <select name="kind" defaultValue={p.kind} className="h-9 rounded-lg border border-buzz-border bg-buzz-bg px-2 text-sm">
                      <option value="entry">entry (draw)</option>
                      <option value="real">real (instant)</option>
                    </select>
                    <label className="text-xs text-buzz-mute flex items-center gap-1">slots
                      <input name="slots" type="number" min={1} defaultValue={p.slots} className="w-14 h-9 rounded-lg border border-buzz-border bg-buzz-bg px-2 text-sm" />
                    </label>
                    <label className="text-xs text-buzz-mute flex items-center gap-1">sort
                      <input name="sort" type="number" defaultValue={p.sort} className="w-14 h-9 rounded-lg border border-buzz-border bg-buzz-bg px-2 text-sm" />
                    </label>
                    <input name="color" defaultValue={p.color} className="w-24 h-9 rounded-lg border border-buzz-border bg-buzz-bg px-2 text-sm" />
                    <label className="text-xs flex items-center gap-1"><input type="checkbox" name="active" defaultChecked={p.active} /> on</label>
                  </div>
                  <div className="flex gap-2 justify-end">
                    <button className="btn-secondary text-sm">Save</button>
                    <button formAction={deletePrize} className="text-sm text-red-600 hover:underline px-2">Delete</button>
                  </div>
                </form>
              ))}
            </div>

            {/* Add a prize */}
            <form action={upsertPrize} className="rounded-lg border border-dashed border-buzz-border p-3 flex flex-wrap gap-2 items-center">
              <input name="label" placeholder="New prize label" className="flex-1 min-w-[140px] h-9 rounded-lg border border-buzz-border bg-buzz-bg px-2 text-sm" />
              <select name="kind" defaultValue="entry" className="h-9 rounded-lg border border-buzz-border bg-buzz-bg px-2 text-sm">
                <option value="entry">entry (draw)</option>
                <option value="real">real (instant)</option>
              </select>
              <input name="slots" type="number" min={1} defaultValue={1} className="w-14 h-9 rounded-lg border border-buzz-border bg-buzz-bg px-2 text-sm" title="slots" />
              <input name="sort" type="number" defaultValue={prizes.length + 1} className="w-14 h-9 rounded-lg border border-buzz-border bg-buzz-bg px-2 text-sm" title="sort" />
              <input name="color" defaultValue="#9B4DFF" className="w-24 h-9 rounded-lg border border-buzz-border bg-buzz-bg px-2 text-sm" />
              <label className="text-xs flex items-center gap-1"><input type="checkbox" name="active" defaultChecked /> on</label>
              <button className="btn-secondary text-sm">Add prize</button>
            </form>
          </section>

          {/* Draw winners */}
          <section className="mb-10">
            <h2 className="font-display text-2xl mb-1">Draw a winner</h2>
            <p className="text-sm text-buzz-mute mb-3">
              Picks a random winner from <strong>confirmed</strong> entries only. Confirmed entries so far:{" "}
              {entryLabels.map((l) => `${l} (${entryTally[l] ?? 0})`).join(" · ") || "none yet"}.
            </p>
            <DrawButtons labels={entryLabels} />
          </section>

          {/* Instant-prize wins to fulfil */}
          <section>
            <h2 className="font-display text-2xl mb-1">Instant prizes to hand out</h2>
            <p className="text-sm text-buzz-mute mb-3">Real prizes people have won. Tick when you&apos;ve sorted them.</p>
            {realWins.length === 0 ? (
              <p className="text-sm text-buzz-mute">No instant prizes won yet.</p>
            ) : (
              <div className="flex flex-col gap-1.5">
                {realWins.map((w) => (
                  <form key={w.id} action={setSpinFulfilled} className="flex items-center gap-2 rounded-lg border border-buzz-border bg-buzz-card px-3 py-2 text-sm">
                    <input type="hidden" name="id" value={w.id} />
                    <input type="hidden" name="fulfilled" value={(!w.fulfilled).toString()} />
                    <span className={`shrink-0 ${w.fulfilled ? "line-through text-buzz-mute" : ""}`}>{w.prize_label}</span>
                    <span className="text-buzz-mute truncate">— {w.email}</span>
                    <span className="text-buzz-mute ml-auto shrink-0 text-xs">{w.spun_on}</span>
                    <button className={`shrink-0 text-xs px-2 py-1 rounded-lg ${w.fulfilled ? "text-buzz-mute" : "bg-buzz-accent text-white"}`}>
                      {w.fulfilled ? "Undo" : "Mark done"}
                    </button>
                  </form>
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
