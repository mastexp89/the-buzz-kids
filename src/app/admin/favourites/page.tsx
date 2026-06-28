import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";
export const metadata = { title: "Favourites — The Buzz Guide admin" };

// Admin view: who's loved what. Pulls every favourite row, joins with
// the target entity for name/slug, and the user profile for email +
// display name. Lists the top 50 entities per target type, ordered by
// favourite count. Each row expands to show who favourited it.

type Tab = "venue" | "artist" | "organiser" | "event";

type FavRow = {
  target_id: string;
  count: number;
  entity: { name: string; slug?: string | null } | null;
  users: { email: string | null; display_name: string | null }[];
};

type Props = { searchParams: Promise<{ tab?: string }> };

export default async function AdminFavouritesPage({ searchParams }: Props) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: me } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (me?.role !== "admin") {
    return (
      <div className="container-page py-16 text-center">
        <h1 className="h-display text-3xl mb-2">Admins only</h1>
        <Link href="/dashboard" className="btn-secondary mt-6 inline-block">Back to dashboard</Link>
      </div>
    );
  }

  const sp = await searchParams;
  const tab = (sp.tab ?? "venue") as Tab;

  // Service client so we bypass favourites RLS (admin needs to see all).
  const sb = createServiceClient();

  // Pull every favourite row of the target type along with the user's
  // profile info. The favourites table has no FK to profiles so we
  // resolve in a second query rather than via a join.
  const { data: favs } = await sb
    .from("favourites")
    .select("user_id, target_id, created_at")
    .eq("target_type", tab)
    .order("created_at", { ascending: false });

  // Tally per target_id + collect user_ids
  const tally = new Map<string, Set<string>>();
  for (const f of favs ?? []) {
    const tid = (f as any).target_id as string;
    const uid = (f as any).user_id as string;
    const set = tally.get(tid) ?? new Set<string>();
    set.add(uid);
    tally.set(tid, set);
  }

  const targetIds = Array.from(tally.keys());
  const userIds = Array.from(new Set((favs ?? []).map((f: any) => f.user_id as string)));

  // Resolve entity names per target type, in one query each.
  let entityById = new Map<string, { name: string; slug?: string | null }>();
  if (targetIds.length > 0) {
    if (tab === "venue") {
      const { data: rows } = await sb.from("venues").select("id, name, slug").in("id", targetIds);
      for (const r of rows ?? []) entityById.set(r.id, { name: r.name, slug: r.slug });
    } else if (tab === "artist") {
      const { data: rows } = await sb.from("artists").select("id, name, slug").in("id", targetIds);
      for (const r of rows ?? []) entityById.set(r.id, { name: r.name, slug: r.slug });
    } else if (tab === "organiser") {
      const { data: rows } = await sb.from("organisers").select("id, name, slug").in("id", targetIds);
      for (const r of rows ?? []) entityById.set(r.id, { name: r.name, slug: r.slug });
    } else if (tab === "event") {
      const { data: rows } = await sb.from("events").select("id, title").in("id", targetIds);
      for (const r of rows ?? []) entityById.set(r.id, { name: r.title });
    }
  }

  // Resolve user names + emails in one query
  let userById = new Map<string, { email: string | null; display_name: string | null }>();
  if (userIds.length > 0) {
    const { data: profs } = await sb.from("profiles").select("id, email, display_name").in("id", userIds);
    for (const p of profs ?? []) userById.set(p.id, { email: p.email, display_name: p.display_name });
  }

  // Build sorted leaderboard
  const rows: FavRow[] = targetIds
    .map((tid) => {
      const userSet = tally.get(tid) ?? new Set<string>();
      const users = Array.from(userSet)
        .map((uid) => userById.get(uid) ?? { email: null, display_name: null });
      return {
        target_id: tid,
        count: userSet.size,
        entity: entityById.get(tid) ?? null,
        users,
      };
    })
    .sort((a, b) => b.count - a.count)
    .slice(0, 100);

  const totals = {
    venue: 0,
    artist: 0,
    organiser: 0,
    event: 0,
  };
  // Cheap separate count per target_type for the tab badges
  for (const t of ["venue", "artist", "organiser", "event"] as Tab[]) {
    const { count } = await sb
      .from("favourites")
      .select("id", { count: "exact", head: true })
      .eq("target_type", t);
    totals[t] = count ?? 0;
  }

  return (
    <div className="container-page py-10 max-w-4xl">
      <Link href="/admin" className="text-sm text-buzz-mute hover:text-buzz-accent transition">← Back to admin</Link>
      <p className="eyebrow mt-3 mb-1">Admin · Favourites</p>
      <h1 className="h-display text-4xl mb-2">♥ Who&apos;s loved what</h1>
      <p className="text-buzz-mute mb-6 max-w-xl text-sm">
        Top 100 most-favourited venues, artists, organisers and events — plus the users behind each heart.
      </p>

      <div className="flex flex-wrap gap-2 mb-6 border-b border-buzz-border/60 pb-2">
        <TabLink active={tab === "venue"} href="?tab=venue" label={`🐝 Venues (${totals.venue})`} />
        <TabLink active={tab === "artist"} href="?tab=artist" label={`🎤 Artists (${totals.artist})`} />
        <TabLink active={tab === "organiser"} href="?tab=organiser" label={`📋 Organisers (${totals.organiser})`} />
        <TabLink active={tab === "event"} href="?tab=event" label={`🎟️ Events (${totals.event})`} />
      </div>

      {rows.length === 0 ? (
        <div className="card p-10 text-center text-buzz-mute">
          Nothing favourited yet in this category.
        </div>
      ) : (
        <ul className="card divide-y divide-buzz-border/60">
          {rows.map((row) => (
            <li key={row.target_id} className="p-4">
              <details>
                <summary className="cursor-pointer flex items-center gap-3 list-none">
                  <span
                    className="inline-flex items-center justify-center min-w-[40px] h-10 rounded-full text-sm font-bold bg-rose-500/15 text-rose-300 border border-rose-500/40"
                  >
                    ♥ {row.count}
                  </span>
                  <span className="flex-1 min-w-0">
                    <span className="font-medium block truncate">
                      {row.entity?.name ?? <span className="text-buzz-mute italic">(deleted entity)</span>}
                    </span>
                    {row.entity?.slug && (
                      <span className="text-xs text-buzz-mute font-mono">{row.entity.slug}</span>
                    )}
                  </span>
                  <span className="text-xs text-buzz-mute">click to expand ▾</span>
                </summary>
                <div className="mt-3 ml-12 flex flex-col gap-1 text-sm">
                  {row.users.length === 0 ? (
                    <span className="text-buzz-mute italic text-xs">No user info resolved.</span>
                  ) : (
                    row.users.map((u, i) => (
                      <div key={i} className="text-buzz-mute">
                        <span className="text-buzz-text">{u.display_name ?? "(no name)"}</span>
                        {u.email && <span className="text-xs"> · {u.email}</span>}
                      </div>
                    ))
                  )}
                </div>
              </details>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function TabLink({ active, href, label }: { active: boolean; href: string; label: string }) {
  return (
    <Link
      href={href}
      className={
        active
          ? "px-3 py-1.5 rounded-full text-sm font-semibold bg-buzz-accent text-black"
          : "px-3 py-1.5 rounded-full text-sm bg-buzz-card border border-buzz-border hover:border-buzz-accent transition"
      }
    >
      {label}
    </Link>
  );
}
