import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [
    { data: venues },
    { data: artists },
    { data: organisers },
    { count: unreadCount },
    { data: profile },
  ] = await Promise.all([
    supabase
      .from("venues")
      .select("id, name, slug, approved, logo_url, created_at")
      .eq("owner_id", user.id)
      .order("created_at", { ascending: true }),
    supabase
      .from("artists")
      .select("id, name, slug, image_url, approved")
      .eq("claimed_by", user.id)
      .order("created_at", { ascending: true }),
    supabase
      .from("organisers")
      .select("id, name, slug, image_url, approved")
      .eq("claimed_by", user.id)
      .order("created_at", { ascending: true }),
    supabase
      .from("messages")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id)
      .eq("from_admin", true)
      .is("read_at", null),
    supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .maybeSingle(),
  ]);
  const unread = unreadCount ?? 0;

  const venueList = venues ?? [];
  const artistList = artists ?? [];
  const organiserList = organisers ?? [];

  // Fans (role='user') don't get the "Add a venue / artist / organiser"
  // links — those flows are for the relevant account types only. If a fan
  // wants to upgrade, they contact admin or create a new account.
  const isFan = profile?.role === "user";

  return (
    <div className="container-page py-6 sm:py-10">
      <div className="grid md:grid-cols-[260px_1fr] gap-6">
        <aside className="md:sticky md:top-24 self-start space-y-3">
          {artistList.length > 0 && (
            <div className="card p-4">
              <div className="eyebrow text-[10px] mb-3">
                Your organiser page{artistList.length === 1 ? "" : "s"} ({artistList.length})
              </div>
              <ul className="flex flex-col gap-1 text-sm">
                {artistList.map((a) => (
                  <li key={a.id}>
                    <Link
                      href={`/dashboard/artist/${a.id}/edit`}
                      className="flex items-center gap-2 px-2 py-2 rounded-lg hover:bg-buzz-surface transition"
                    >
                      {a.image_url ? (
                        <span
                          className="w-7 h-7 rounded-full shrink-0 bg-buzz-surface"
                          style={{ backgroundImage: `url(${a.image_url})`, backgroundSize: "cover", backgroundPosition: "center" }}
                        />
                      ) : (
                        <span className="w-7 h-7 rounded-full shrink-0 bg-buzz-surface border border-buzz-border grid place-items-center text-xs">🎤</span>
                      )}
                      <span className="truncate">{a.name}</span>
                      {!a.approved && <span className="ml-auto text-[10px] text-buzz-accent">●</span>}
                    </Link>
                  </li>
                ))}
                <li>
                  <Link
                    href="/dashboard/setup"
                    className="flex items-center gap-2 px-2 py-2 rounded-lg text-buzz-accent hover:bg-buzz-surface transition"
                  >
                    <span className="w-7 h-7 rounded-full shrink-0 grid place-items-center text-lg leading-none">+</span>
                    Add another band
                  </Link>
                </li>
                <li>
                  <Link
                    href="/submit-gig"
                    className="flex items-center gap-2 px-2 py-2 rounded-lg text-buzz-mute hover:bg-buzz-surface hover:text-buzz-fg transition"
                  >
                    <span className="w-7 h-7 rounded-full shrink-0 grid place-items-center text-base">🎵</span>
                    Submit a gig
                  </Link>
                </li>
              </ul>
            </div>
          )}

          {organiserList.length > 0 && (
            <div className="card p-4">
              <div className="eyebrow text-[10px] mb-3">
                Your organiser page{organiserList.length === 1 ? "" : "s"} ({organiserList.length})
              </div>
              <ul className="flex flex-col gap-1 text-sm">
                {organiserList.map((o) => (
                  <li key={o.id}>
                    <Link
                      href={`/dashboard/organiser/${o.id}/edit`}
                      className="flex items-center gap-2 px-2 py-2 rounded-lg hover:bg-buzz-surface transition"
                    >
                      {o.image_url ? (
                        <span
                          className="w-7 h-7 rounded-full shrink-0 bg-buzz-surface"
                          style={{ backgroundImage: `url(${o.image_url})`, backgroundSize: "cover", backgroundPosition: "center" }}
                        />
                      ) : (
                        <span className="w-7 h-7 rounded-full shrink-0 bg-buzz-surface border border-buzz-border grid place-items-center text-xs">📋</span>
                      )}
                      <span className="truncate">{o.name}</span>
                      {!o.approved && <span className="ml-auto text-[10px] text-buzz-accent">●</span>}
                    </Link>
                  </li>
                ))}
                <li>
                  <Link
                    href="/dashboard/organiser-setup"
                    className="flex items-center gap-2 px-2 py-2 rounded-lg text-buzz-accent hover:bg-buzz-surface transition"
                  >
                    <span className="w-7 h-7 rounded-full shrink-0 grid place-items-center text-lg leading-none">+</span>
                    Add another organiser
                  </Link>
                </li>
              </ul>
            </div>
          )}

          {!isFan && (venueList.length > 0 || artistList.length === 0) && (
          <div className="card p-4">
            <div className="eyebrow text-[10px] mb-3">{venueList.length > 0 ? "Your places" : "Get started"}</div>
            <ul className="flex flex-col gap-1 text-sm">
              {venueList.map((v) => (
                <li key={v.id}>
                  <Link
                    href={`/dashboard/venues/${v.id}`}
                    className="flex items-center gap-2 px-2 py-2 rounded-lg hover:bg-buzz-surface transition"
                  >
                    {v.logo_url ? (
                      <span
                        className="w-7 h-7 rounded-md shrink-0 bg-buzz-surface"
                        style={{ backgroundImage: `url(${v.logo_url})`, backgroundSize: "contain", backgroundPosition: "center", backgroundRepeat: "no-repeat" }}
                      />
                    ) : (
                      <span className="w-7 h-7 rounded-md shrink-0 bg-buzz-surface border border-buzz-border grid place-items-center text-xs">🐝</span>
                    )}
                    <span className="truncate">{v.name}</span>
                    {!v.approved && <span className="ml-auto text-[10px] text-buzz-accent">●</span>}
                  </Link>
                </li>
              ))}
              <li>
                <Link
                  href={venueList.length > 0 ? "/dashboard/venue-setup" : "/dashboard/add"}
                  className="flex items-center gap-2 px-2 py-2 rounded-lg text-buzz-accent hover:bg-buzz-surface transition"
                >
                  <span className="w-7 h-7 rounded-md shrink-0 grid place-items-center text-lg leading-none">+</span>
                  {venueList.length > 0 ? "Add another place" : "Add a place or activity"}
                </Link>
              </li>
            </ul>
          </div>
          )}

          <div className="card p-2">
            <Link href="/dashboard" className="flex items-center gap-2 px-2 py-2 rounded-lg hover:bg-buzz-surface transition text-sm">
              📋 <span>Overview</span>
            </Link>
            {/* Favourites + Day planner + Notifications are open to every
                signed-in user — venue owners, artists, organisers and admins
                all might want to track their own favourite bands / gigs the
                same way fans do. The underlying favourites table is keyed by
                user_id, not role, so nothing else needs to change. */}
            <Link href="/dashboard/favourites" className="flex items-center gap-2 px-2 py-2 rounded-lg hover:bg-buzz-surface transition text-sm">
              ♡ <span>Bucket list</span>
            </Link>
            <Link href="/dashboard/notifications" className="flex items-center gap-2 px-2 py-2 rounded-lg hover:bg-buzz-surface transition text-sm">
              🔔 <span>Notifications</span>
            </Link>
            <Link href="/dashboard/messages" className="flex items-center gap-2 px-2 py-2 rounded-lg hover:bg-buzz-surface transition text-sm">
              📬 <span>Messages</span>
              {unread > 0 && (
                <span className="ml-auto inline-flex items-center justify-center text-[11px] font-bold bg-buzz-accent text-black rounded-full px-2 py-0.5">
                  {unread}
                </span>
              )}
            </Link>
            <Link href="/dashboard/account" className="flex items-center gap-2 px-2 py-2 rounded-lg hover:bg-buzz-surface transition text-sm">
              ⚙️ <span>Account settings</span>
            </Link>
            {!isFan && (
              <Link href="/advertise" className="flex items-center gap-2 px-2 py-2 rounded-lg hover:bg-buzz-surface transition text-sm">
                📣 <span>Advertise</span>
              </Link>
            )}
            <form action="/auth/signout" method="post">
              <button className="w-full flex items-center gap-2 px-2 py-2 rounded-lg hover:bg-buzz-surface transition text-sm text-buzz-mute">
                ↩︎ <span>Sign out</span>
              </button>
            </form>
          </div>
        </aside>
        <div>{children}</div>
      </div>
    </div>
  );
}
