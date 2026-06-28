import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import ActivityLogClient, { type AuditRowProps } from "./ActivityLogClient";

export const dynamic = "force-dynamic";
export const metadata = { title: "Activity log — The Buzz Kids admin" };

// Postgres table_name -> the kind we render in the UI. Order here also
// drives the filter pill order.
const TABLE_TO_KIND = {
  venues: "venue",
  artists: "artist",
  organisers: "organiser",
  events: "event",
} as const;

type Kind = (typeof TABLE_TO_KIND)[keyof typeof TABLE_TO_KIND];

type Props = { searchParams: Promise<{ kind?: string }> };

export default async function ActivityLogPage({ searchParams }: Props) {
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

  const sp = await searchParams;
  const kindFilter = (sp.kind as Kind | "all" | undefined) ?? "all";

  const sb = createServiceClient();
  const sinceIso = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  // Pull recent audit rows. We cap broadly at 500 — the page itself only
  // shows the most recent 200 after filtering, so 500 leaves headroom for
  // the filter pills to still show realistic counts per kind.
  const { data: rows } = await sb
    .from("audit_log")
    .select("id, table_name, row_id, row_name, action, changed_fields, actor_user_id, created_at")
    .gte("created_at", sinceIso)
    .order("created_at", { ascending: false })
    .limit(500);

  // Resolve actor profiles in one batch.
  const actorIds = new Set<string>();
  for (const r of rows ?? []) if (r.actor_user_id) actorIds.add(r.actor_user_id);
  const actorById = new Map<string, { email: string | null; name: string | null }>();
  if (actorIds.size > 0) {
    const { data: profiles } = await sb
      .from("profiles")
      .select("id, email, display_name")
      .in("id", Array.from(actorIds));
    for (const p of profiles ?? []) {
      actorById.set(p.id, { email: p.email ?? null, name: p.display_name ?? null });
    }
  }

  // Look up current slugs / city for "View" links. We do this in one query
  // per table rather than joining inside the audit_log select, because
  // audit rows for deleted entities won't have a matching row anymore.
  const venueIds: string[] = [];
  const artistIds: string[] = [];
  const organiserIds: string[] = [];
  const eventIds: string[] = [];
  for (const r of rows ?? []) {
    if (r.table_name === "venues") venueIds.push(r.row_id);
    else if (r.table_name === "artists") artistIds.push(r.row_id);
    else if (r.table_name === "organisers") organiserIds.push(r.row_id);
    else if (r.table_name === "events") eventIds.push(r.row_id);
  }

  const [venuesLookup, artistsLookup, organisersLookup, eventsLookup] =
    await Promise.all([
      venueIds.length
        ? sb.from("venues").select("id, slug, city:cities(slug)").in("id", venueIds)
        : Promise.resolve({ data: [] as any[] }),
      artistIds.length
        ? sb.from("artists").select("id, slug").in("id", artistIds)
        : Promise.resolve({ data: [] as any[] }),
      organiserIds.length
        ? sb.from("organisers").select("id, slug").in("id", organiserIds)
        : Promise.resolve({ data: [] as any[] }),
      eventIds.length
        ? sb.from("events").select("id, venue:venues(city:cities(slug))").in("id", eventIds)
        : Promise.resolve({ data: [] as any[] }),
    ]);

  const venueHrefById = new Map<string, string>();
  for (const v of venuesLookup.data ?? []) {
    const c = (v as any).city?.slug;
    if (c && v.slug) venueHrefById.set(v.id, `/${c}/venues/${v.slug}`);
  }
  const artistHrefById = new Map<string, string>();
  for (const a of artistsLookup.data ?? []) {
    if (a.slug) artistHrefById.set(a.id, `/artists/${a.slug}`);
  }
  const organiserHrefById = new Map<string, string>();
  for (const o of organisersLookup.data ?? []) {
    if (o.slug) organiserHrefById.set(o.id, `/organisers/${o.slug}`);
  }
  const eventHrefById = new Map<string, string>();
  for (const e of eventsLookup.data ?? []) {
    const c = (e as any).venue?.city?.slug;
    if (c) eventHrefById.set(e.id, `/${c}/events/${e.id}`);
  }

  const enriched: AuditRowProps[] = (rows ?? []).map((r) => {
    const actor = r.actor_user_id ? actorById.get(r.actor_user_id) ?? null : null;
    const kind = (TABLE_TO_KIND as Record<string, Kind>)[r.table_name] ?? "venue";
    let href: string | null = null;
    if (r.action !== "delete") {
      if (r.table_name === "venues") href = venueHrefById.get(r.row_id) ?? null;
      else if (r.table_name === "artists") href = artistHrefById.get(r.row_id) ?? null;
      else if (r.table_name === "organisers") href = organiserHrefById.get(r.row_id) ?? null;
      else if (r.table_name === "events") href = eventHrefById.get(r.row_id) ?? null;
    }
    return {
      id: r.id,
      kind,
      action: r.action as AuditRowProps["action"],
      name: r.row_name ?? "(no name)",
      who: actor?.name ?? null,
      whoEmail: actor?.email ?? null,
      at: r.created_at,
      changedFields: r.changed_fields ?? {},
      href,
    };
  });

  const filtered =
    kindFilter && kindFilter !== "all"
      ? enriched.filter((r) => r.kind === kindFilter)
      : enriched;
  const list = filtered.slice(0, 200);

  const counts = {
    venue: enriched.filter((r) => r.kind === "venue").length,
    artist: enriched.filter((r) => r.kind === "artist").length,
    organiser: enriched.filter((r) => r.kind === "organiser").length,
    event: enriched.filter((r) => r.kind === "event").length,
    all: enriched.length,
  };

  return (
    <div className="container-page py-10 max-w-4xl">
      <Link href="/admin" className="text-sm text-buzz-mute hover:text-buzz-accent transition">
        ← Back to admin
      </Link>
      <p className="eyebrow mt-3 mb-1">Admin</p>
      <h1 className="h-display text-4xl sm:text-5xl mb-2">📜 Activity log</h1>
      <p className="text-buzz-mute mb-6 max-w-2xl">
        Field-by-field record of edits + creates + deletes by place owners
        and event organisers — last 30 days. Cron jobs, AI imports and admin
        approvals are excluded.
      </p>

      <div className="flex flex-wrap items-center gap-2 mb-5">
        <span className="text-xs uppercase tracking-wider text-buzz-mute mr-1">Filter</span>
        {([
          ["all", "All", counts.all],
          ["venue", "🐝 Places", counts.venue],
          ["organiser", "📋 Organisers", counts.organiser],
          ["event", "🎟️ Sessions", counts.event],
        ] as const).map(([k, label, count]) => {
          const active = (kindFilter ?? "all") === k;
          return (
            <Link
              key={k}
              href={k === "all" ? "/admin/activity-log" : `/admin/activity-log?kind=${k}`}
              className={
                "px-3 py-1.5 rounded-full text-sm transition " +
                (active
                  ? "bg-buzz-accent text-buzz-bg font-medium"
                  : "bg-buzz-card text-buzz-mute hover:text-buzz-fg")
              }
            >
              {label} <span className="opacity-60">{count}</span>
            </Link>
          );
        })}
      </div>

      {list.length === 0 ? (
        <div className="card p-10 text-center text-buzz-mute">
          No user activity in the last 30 days for this filter.
        </div>
      ) : (
        <ActivityLogClient rows={list} />
      )}
    </div>
  );
}
