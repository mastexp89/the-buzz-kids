import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import AdminVenueRow from "./AdminVenueRow";
import AdminVenueList from "./AdminVenueList";
import AdminUserRow from "./AdminUserRow";
import AdminToolGroups from "./AdminToolGroups";
import LiveActivity from "./LiveActivity";

export const dynamic = "force-dynamic";

type Props = { searchParams: Promise<{ city?: string }> };

export default async function AdminPage({ searchParams }: Props) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: me } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  // Editors are restricted contributors: they can only add places and events
  // (auto-approved). Show them a simple home with just those two actions —
  // not the full Control Room.
  if (me?.role === "editor") {
    return (
      <div className="container-page py-12 max-w-3xl">
        <p className="eyebrow mb-1">Contributor</p>
        <h1 className="h-display text-4xl sm:text-5xl mb-2">Add to The Buzz Kids</h1>
        <p className="text-buzz-mute mb-8 max-w-xl">
          Thanks for helping build the directory! You can add places and events — they go
          live straight away, no approval needed.
        </p>
        <div className="grid sm:grid-cols-2 gap-4">
          <Link href="/admin/venues/new" className="card-hover p-6 lift flex flex-col gap-1">
            <span className="text-3xl">➕</span>
            <span className="font-display text-2xl uppercase mt-1">Add a place</span>
            <span className="text-sm text-buzz-mute">A soft play, museum, park, leisure centre…</span>
          </Link>
          <Link href="/admin/events/new" className="card-hover p-6 lift flex flex-col gap-1">
            <span className="text-3xl">🎉</span>
            <span className="font-display text-2xl uppercase mt-1">Add an event</span>
            <span className="text-sm text-buzz-mute">A gala, fayre, holiday club or special day.</span>
          </Link>
          <Link href="/admin/offers" className="card-hover p-6 lift flex flex-col gap-1">
            <span className="text-3xl">🎟️</span>
            <span className="font-display text-2xl uppercase mt-1">Add a deal</span>
            <span className="text-sm text-buzz-mute">Kids eat free / for £1, or a cheap day out.</span>
          </Link>
          <Link href="/admin/paste-event" className="card-hover p-6 lift flex flex-col gap-1">
            <span className="text-3xl">📋</span>
            <span className="font-display text-2xl uppercase mt-1">Paste from Facebook</span>
            <span className="text-sm text-buzz-mute">Paste a post → we pull out the event for you.</span>
          </Link>
        </div>
      </div>
    );
  }
  if (me?.role !== "admin") {
    return (
      <div className="container-page py-16 text-center">
        <h1 className="h-display text-3xl mb-2">Admins only</h1>
        <p className="text-buzz-mute">Your account isn't an admin.</p>
        <Link href="/dashboard" className="btn-secondary mt-6 inline-block">Back to dashboard</Link>
      </div>
    );
  }

  const sp = await searchParams;
  const cityFilterSlug = sp.city && sp.city !== "all" ? sp.city : null;

  // Fetch every city (active OR hidden) for the admin filter pills, so
  // admin can still drill into a hidden region's venues while populating
  // it. We tag hidden cities with a marker in the UI below.
  const { data: allCities } = await supabase
    .from("cities")
    .select("id, name, slug, active")
    .order("name");
  const filterCityId = cityFilterSlug
    ? allCities?.find((c) => c.slug === cityFilterSlug)?.id ?? null
    : null;

  const now = new Date();
  const nowIso = now.toISOString();
  const in24hIso = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();

  // Conditionally apply city filter to the venue queries.
  const pendingBase = supabase
    .from("venues")
    .select("*, city:cities(*), owner:profiles!owner_id(email, display_name)")
    .eq("approved", false);
  const pendingQuery = filterCityId
    ? pendingBase.eq("city_id", filterCityId).order("created_at", { ascending: false })
    : pendingBase.order("created_at", { ascending: false });

  const approvedBase = supabase
    .from("venues")
    .select("*, city:cities(*), owner:profiles!owner_id(email, display_name)")
    .eq("approved", true);
  const approvedQuery = filterCityId
    ? approvedBase.eq("city_id", filterCityId).order("name")
    : approvedBase.order("name");

  const [
    { data: pending },
    { data: approved },
    { data: users },
    { data: allOwnerVenues },
    { data: expiringSpotlightVenues },
    { data: expiringPromoEvents },
  ] = await Promise.all([
    pendingQuery,
    approvedQuery,
    supabase
      .from("profiles")
      .select("id, email, display_name, role, created_at")
      .order("created_at", { ascending: false }),
    supabase
      .from("venues")
      .select("owner_id"),
    supabase
      .from("venues")
      .select("id, name, spotlight_until")
      .gt("spotlight_until", nowIso)
      .lte("spotlight_until", in24hIso)
      .order("spotlight_until", { ascending: true }),
    supabase
      .from("events")
      .select(
        "id, title, start_time, featured_until, highlighted_until, genre_takeover_until, weekend_boost_until, venue:venues!inner(id, name)",
      )
      .or(
        `and(featured_until.gt.${nowIso},featured_until.lte.${in24hIso}),` +
          `and(highlighted_until.gt.${nowIso},highlighted_until.lte.${in24hIso}),` +
          `and(genre_takeover_until.gt.${nowIso},genre_takeover_until.lte.${in24hIso}),` +
          `and(weekend_boost_until.gt.${nowIso},weekend_boost_until.lte.${in24hIso})`,
      )
      .order("start_time", { ascending: true }),
  ]);

  // Flatten event promos into per-row entries (one row per active expiring promo column).
  type ExpiringRow = {
    id: string;
    label: string;
    emoji: string;
    venueId: string;
    venueName: string;
    eventTitle?: string;
    expiresAt: string;
    href: string;
  };

  const EVENT_KINDS: { col: keyof any; emoji: string; label: string }[] = [
    { col: "featured_until", emoji: "📌", label: "Pin to top" },
    { col: "highlighted_until", emoji: "⭐", label: "Highlight" },
    { col: "genre_takeover_until", emoji: "🎚️", label: "Genre takeover" },
    { col: "weekend_boost_until", emoji: "🔥", label: "Weekend boost" },
  ];

  const expiringRows: ExpiringRow[] = [];
  for (const v of expiringSpotlightVenues ?? []) {
    expiringRows.push({
      id: `v:${v.id}`,
      label: "Spotlight",
      emoji: "🔦",
      venueId: v.id,
      venueName: v.name,
      expiresAt: v.spotlight_until,
      href: `/admin/venues/${v.id}/promote`,
    });
  }
  for (const e of expiringPromoEvents ?? []) {
    for (const k of EVENT_KINDS) {
      const at = (e as any)[k.col] as string | null;
      if (!at) continue;
      const ts = new Date(at).getTime();
      if (ts <= now.getTime() || ts > now.getTime() + 24 * 60 * 60 * 1000)
        continue;
      const venue = (e as any).venue ?? {};
      expiringRows.push({
        id: `e:${e.id}:${String(k.col)}`,
        label: k.label,
        emoji: k.emoji,
        venueId: venue.id,
        venueName: venue.name ?? "—",
        eventTitle: e.title,
        expiresAt: at,
        href: `/admin/venues/${venue.id}/promote`,
      });
    }
  }
  expiringRows.sort(
    (a, b) =>
      new Date(a.expiresAt).getTime() - new Date(b.expiresAt).getTime(),
  );

  function hoursUntil(iso: string) {
    const ms = new Date(iso).getTime() - now.getTime();
    if (ms <= 0) return "expired";
    const h = Math.round(ms / (60 * 60 * 1000));
    return h <= 1 ? "<1h" : `${h}h`;
  }

  const venueCountByOwner = new Map<string, number>();
  for (const v of allOwnerVenues ?? []) {
    if (v.owner_id) venueCountByOwner.set(v.owner_id, (venueCountByOwner.get(v.owner_id) ?? 0) + 1);
  }

  const admins = (users ?? []).filter((u) => u.role === "admin");
  const others = (users ?? []).filter((u) => u.role !== "admin");

  return (
    <div className="container-page py-10 max-w-5xl">
      <p className="eyebrow mb-1">Admin</p>
      <h1 className="h-display text-4xl sm:text-5xl mb-3">Control room</h1>
      <AdminToolGroups pendingCount={pending?.length ?? 0} />

      <LiveActivity />


      {expiringRows.length > 0 && (
        <section className="mb-10">
          <div className="card border-buzz-accent/60 bg-buzz-accent/5 p-5">
            <div className="flex items-baseline justify-between flex-wrap gap-2 mb-3">
              <h2 className="font-display text-xl uppercase">
                ⏳ Expiring in next 24h{" "}
                <span className="text-buzz-mute text-sm font-normal">
                  ({expiringRows.length})
                </span>
              </h2>
              <Link
                href="/admin/promotions"
                className="text-xs text-buzz-accent hover:text-buzz-accent2"
              >
                See all promotions →
              </Link>
            </div>
            <ul className="divide-y divide-buzz-border/40">
              {expiringRows.map((r) => (
                <li
                  key={r.id}
                  className="py-2 flex items-center gap-3 justify-between flex-wrap text-sm"
                >
                  <div className="min-w-0">
                    <span className="mr-1">{r.emoji}</span>
                    <span className="font-medium">{r.label}</span>
                    <span className="text-buzz-mute"> · </span>
                    <span>{r.venueName}</span>
                    {r.eventTitle && (
                      <>
                        <span className="text-buzz-mute"> · </span>
                        <span className="truncate">{r.eventTitle}</span>
                      </>
                    )}
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-buzz-accent font-display">
                      {hoursUntil(r.expiresAt)} left
                    </span>
                    <Link href={r.href} className="btn-ghost text-xs">
                      Open
                    </Link>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}

      {/* City filter pills — only render when there's more than one active
          city. Filters BOTH pending and approved venue lists below. */}
      {(allCities?.length ?? 0) > 1 && (
        <div className="mb-6 flex flex-wrap items-center gap-2">
          <span className="text-xs uppercase tracking-wider text-buzz-mute mr-1">Filter by city</span>
          <Link
            href="/admin"
            className={
              "px-3 py-1.5 rounded-full text-sm transition " +
              (!cityFilterSlug
                ? "bg-buzz-accent text-buzz-bg font-medium"
                : "bg-buzz-card text-buzz-mute hover:text-buzz-fg")
            }
          >
            All
          </Link>
          {(allCities ?? []).map((c) => (
            <Link
              key={c.slug}
              href={`/admin?city=${c.slug}`}
              title={c.active ? c.name : `${c.name} (hidden from public site)`}
              className={
                "px-3 py-1.5 rounded-full text-sm transition flex items-center gap-1.5 " +
                (cityFilterSlug === c.slug
                  ? "bg-buzz-accent text-buzz-bg font-medium"
                  : "bg-buzz-card text-buzz-mute hover:text-buzz-fg")
              }
            >
              {c.name}
              {!c.active && (
                <span
                  aria-label="hidden"
                  className={
                    "text-[10px] uppercase tracking-wider px-1 rounded " +
                    (cityFilterSlug === c.slug
                      ? "bg-buzz-bg/20"
                      : "bg-buzz-mute/20 text-buzz-mute")
                  }
                >
                  hidden
                </span>
              )}
            </Link>
          ))}
        </div>
      )}

      <section className="mb-12">
        <h2 className="font-display text-2xl uppercase mb-3">
          Pending places
          {cityFilterSlug && <span className="text-buzz-mute text-sm font-normal"> in {allCities?.find((c) => c.slug === cityFilterSlug)?.name ?? cityFilterSlug}</span>}
          <span className="text-buzz-mute text-sm font-normal"> ({pending?.length ?? 0})</span>
        </h2>
        {pending && pending.length > 0 ? (
          <AdminVenueList venues={pending as any} pending />
        ) : (
          <div className="card p-6 text-buzz-mute">No pending places. ✨</div>
        )}
      </section>

      <details className="mb-12 group">
        <summary className="cursor-pointer list-none flex items-center gap-2 mb-3 hover:text-buzz-accent transition">
          <span className="inline-block transition-transform group-open:rotate-90 text-buzz-mute">▶</span>
          <h2 className="font-display text-2xl uppercase inline">
            Approved places
            {cityFilterSlug && <span className="text-buzz-mute text-sm font-normal"> in {allCities?.find((c) => c.slug === cityFilterSlug)?.name ?? cityFilterSlug}</span>}
            <span className="text-buzz-mute text-sm font-normal"> ({approved?.length ?? 0})</span>
          </h2>
        </summary>
        {approved && approved.length > 0 ? (
          <AdminVenueList venues={approved as any} />
        ) : (
          <div className="card p-6 text-buzz-mute">No approved places yet.</div>
        )}
      </details>

      <div className="flex items-center justify-between gap-3 flex-wrap mb-4">
        <h2 className="font-display text-2xl uppercase">People</h2>
        <Link href="/admin/users/new" className="btn-primary">+ Add account</Link>
      </div>

      <details className="mb-12 group">
        <summary className="cursor-pointer list-none flex items-center gap-2 mb-3 hover:text-buzz-accent transition">
          <span className="inline-block transition-transform group-open:rotate-90 text-buzz-mute">▶</span>
          <h2 className="font-display text-2xl uppercase inline">
            Admins <span className="text-buzz-mute text-sm font-normal">({admins.length})</span>
          </h2>
        </summary>
        <ul className="card divide-y divide-buzz-border/60">
          {admins.map((u) => (
            <AdminUserRow
              key={u.id}
              user={u as any}
              isCurrentUser={u.id === user.id}
              venueCount={venueCountByOwner.get(u.id) ?? 0}
            />
          ))}
        </ul>
      </details>

      <details className="group">
        <summary className="cursor-pointer list-none flex items-center gap-2 mb-3 hover:text-buzz-accent transition">
          <span className="inline-block transition-transform group-open:rotate-90 text-buzz-mute">▶</span>
          <h2 className="font-display text-2xl uppercase inline">
            All users <span className="text-buzz-mute text-sm font-normal">({others.length})</span>
          </h2>
        </summary>
        <p className="text-sm text-buzz-mute mb-3">
          Promote a venue owner to admin to share moderation duties.
        </p>
        {others.length > 0 ? (
          <ul className="card divide-y divide-buzz-border/60">
            {others.map((u) => (
              <AdminUserRow
                key={u.id}
                user={u as any}
                isCurrentUser={false}
                venueCount={venueCountByOwner.get(u.id) ?? 0}
              />
            ))}
          </ul>
        ) : (
          <div className="card p-6 text-buzz-mute">No other users yet.</div>
        )}
      </details>
    </div>
  );
}
