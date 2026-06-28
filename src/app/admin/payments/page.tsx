import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const PROMO_LABEL: Record<string, string> = {
  featured_pin: "Featured pin",
  spotlight: "Venue spotlight",
  highlighted_gig: "Highlighted gig",
  genre_takeover: "Genre takeover",
  weekend_boost: "Weekend boost",
};

function fmtMoney(amountCents: number, currency: string) {
  const symbol = currency.toLowerCase() === "gbp" ? "£" : currency.toUpperCase() + " ";
  return `${symbol}${(amountCents / 100).toFixed(2)}`;
}

export default async function AdminPaymentsPage({
  searchParams,
}: {
  searchParams: Promise<{ since?: string; type?: string }>;
}) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: me } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  if (me?.role !== "admin") {
    return (
      <div className="container-page py-16 text-center">
        <h1 className="h-display text-3xl mb-2">Admins only</h1>
        <Link href="/dashboard" className="btn-secondary mt-6 inline-block">Back</Link>
      </div>
    );
  }

  const sp = await searchParams;
  const since = sp.since ?? "30d"; // 7d, 30d, 90d, all
  const typeFilter = sp.type ?? "all"; // all, subscription, promotion

  const sinceDate = (() => {
    const d = new Date();
    if (since === "7d") d.setDate(d.getDate() - 7);
    else if (since === "30d") d.setDate(d.getDate() - 30);
    else if (since === "90d") d.setDate(d.getDate() - 90);
    else return null;
    return d.toISOString();
  })();

  let query = supabase
    .from("payments")
    .select(`*, venue:venues(name, slug, city:cities(name)), owner:profiles!owner_id(email, display_name)`)
    .order("created_at", { ascending: false })
    .limit(500);
  if (sinceDate) query = query.gte("created_at", sinceDate);
  if (typeFilter !== "all") query = query.eq("type", typeFilter);

  const { data: payments } = await query;
  const rows = (payments ?? []) as any[];

  const totalCents = rows.reduce((s, r) => s + (r.amount_cents ?? 0), 0);
  const subTotal = rows.filter((r) => r.type === "subscription").reduce((s, r) => s + (r.amount_cents ?? 0), 0);
  const promoTotal = rows.filter((r) => r.type === "promotion").reduce((s, r) => s + (r.amount_cents ?? 0), 0);

  const SINCE_OPTS: { v: string; label: string }[] = [
    { v: "7d", label: "Last 7 days" },
    { v: "30d", label: "Last 30 days" },
    { v: "90d", label: "Last 90 days" },
    { v: "all", label: "All time" },
  ];
  const TYPE_OPTS: { v: string; label: string }[] = [
    { v: "all", label: "All" },
    { v: "subscription", label: "Subscriptions" },
    { v: "promotion", label: "Promotions" },
  ];

  return (
    <div className="container-page py-10 max-w-6xl">
      <Link href="/admin" className="text-sm text-buzz-mute hover:text-buzz-accent transition">
        ← Back to admin
      </Link>
      <p className="eyebrow mt-3 mb-1">Admin · Money in</p>
      <h1 className="h-display text-4xl sm:text-5xl mb-8">Payments</h1>

      {/* Totals */}
      <div className="grid sm:grid-cols-3 gap-3 mb-8">
        <div className="card p-5">
          <div className="text-xs uppercase tracking-widest text-buzz-mute font-semibold">Total in window</div>
          <div className="font-display text-4xl mt-2 text-buzz-accent">{fmtMoney(totalCents, "gbp")}</div>
          <div className="text-xs text-buzz-mute mt-1">{rows.length} payment{rows.length === 1 ? "" : "s"}</div>
        </div>
        <div className="card p-5">
          <div className="text-xs uppercase tracking-widest text-buzz-mute font-semibold">Subscriptions</div>
          <div className="font-display text-4xl mt-2">{fmtMoney(subTotal, "gbp")}</div>
        </div>
        <div className="card p-5">
          <div className="text-xs uppercase tracking-widest text-buzz-mute font-semibold">Promotions</div>
          <div className="font-display text-4xl mt-2">{fmtMoney(promoTotal, "gbp")}</div>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2 mb-6">
        <span className="text-xs uppercase tracking-widest text-buzz-mute font-semibold mr-2">Period:</span>
        {SINCE_OPTS.map((o) => (
          <Link
            key={o.v}
            href={`/admin/payments?since=${o.v}&type=${typeFilter}`}
            className={since === o.v ? "chip-accent" : "chip"}
          >
            {o.label}
          </Link>
        ))}
        <span className="text-xs uppercase tracking-widest text-buzz-mute font-semibold ml-4 mr-2">Type:</span>
        {TYPE_OPTS.map((o) => (
          <Link
            key={o.v}
            href={`/admin/payments?since=${since}&type=${o.v}`}
            className={typeFilter === o.v ? "chip-accent" : "chip"}
          >
            {o.label}
          </Link>
        ))}
      </div>

      {/* Table */}
      {rows.length === 0 ? (
        <div className="card p-10 text-center text-buzz-mute">
          No payments in this window.
        </div>
      ) : (
        <ul className="card divide-y divide-buzz-border/60">
          {rows.map((r) => (
            <li key={r.id} className="p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span
                    className={`text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full ${
                      r.type === "subscription"
                        ? "bg-emerald-500/15 text-emerald-300 border border-emerald-500/40"
                        : "bg-buzz-accent/15 text-buzz-accent border border-buzz-accent/40"
                    }`}
                  >
                    {r.type === "subscription" ? "Subscription" : PROMO_LABEL[r.promotion_kind] ?? "Promotion"}
                  </span>
                  <span className="font-display uppercase tracking-tight text-lg truncate">
                    {r.venue?.name ?? "—"}
                  </span>
                </div>
                <div className="text-xs text-buzz-mute mt-1 truncate">
                  {r.owner?.display_name || r.owner?.email || "unknown"}
                  {r.venue?.city?.name && <> · {r.venue.city.name}</>}
                  <> · {new Date(r.created_at).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}</>
                </div>
                {r.description && <div className="text-xs text-buzz-mute mt-0.5">{r.description}</div>}
              </div>
              <div className="text-right shrink-0">
                <div className="font-display text-2xl text-buzz-accent">{fmtMoney(r.amount_cents, r.currency)}</div>
                {r.status !== "succeeded" && (
                  <div className="text-[10px] uppercase tracking-widest text-rose-400">{r.status}</div>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
