import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { formatEventTime } from "@/lib/utils";
import QRCodeCard from "@/components/QRCodeCard";
import PendingGigsList from "./PendingGigsList";
import PullFacebookButton from "./PullFacebookButton";

export const dynamic = "force-dynamic";

export default async function VenueDashboardPage({ params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient();
  const { id } = await params;
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  // Admins can view any venue's dashboard, owners only their own.
  const { data: me } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  const isAdmin = me?.role === "admin";

  let venueQuery = supabase
    .from("venues")
    .select("*, city:cities(name, slug)")
    .eq("id", id);
  if (!isAdmin) venueQuery = venueQuery.eq("owner_id", user.id);

  const { data: venue } = await venueQuery.maybeSingle();

  if (!venue) notFound();

  const now = new Date().toISOString();
  const { data: upcoming } = await supabase
    .from("events").select("*")
    .eq("venue_id", venue.id)
    .gte("start_time", now)
    .or("status.is.null,status.eq.approved")
    .order("start_time", { ascending: true })
    .limit(50);
  const { data: pendingGigsRaw } = await supabase
    .from("events").select("*")
    .eq("venue_id", venue.id)
    .eq("status", "pending")
    .order("start_time", { ascending: true });
  // Fetch submitter info separately — events.submitted_by FKs to auth.users, not profiles,
  // so PostgREST can't resolve the join automatically.
  const submitterIds = Array.from(new Set((pendingGigsRaw ?? []).map((g: any) => g.submitted_by).filter(Boolean)));
  const submitterMap = new Map<string, { email: string | null; display_name: string | null }>();
  if (submitterIds.length > 0) {
    const { data: submitters } = await supabase
      .from("profiles")
      .select("id, email, display_name")
      .in("id", submitterIds);
    for (const s of submitters ?? []) {
      submitterMap.set(s.id, { email: s.email, display_name: s.display_name });
    }
  }
  const pendingGigs = (pendingGigsRaw ?? []).map((g: any) => ({
    ...g,
    submitter: g.submitted_by ? submitterMap.get(g.submitted_by) ?? null : null,
  }));
  const { data: past } = await supabase
    .from("events").select("*")
    .eq("venue_id", venue.id)
    .lt("start_time", now)
    .or("status.is.null,status.eq.approved")
    .order("start_time", { ascending: false })
    .limit(5);

  return (
    <div className="flex flex-col gap-8">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-4">
          {venue.logo_url ? (
            <div
              className="w-16 h-16 rounded-xl bg-buzz-surface border border-buzz-border shrink-0"
              style={{ backgroundImage: `url(${venue.logo_url})`, backgroundSize: "contain", backgroundPosition: "center", backgroundRepeat: "no-repeat" }}
            />
          ) : (
            <div className="w-16 h-16 rounded-xl bg-buzz-surface border border-buzz-border grid place-items-center text-buzz-accent text-2xl shrink-0">
              🐝
            </div>
          )}
          <div>
            <p className="eyebrow mb-1">
              {(venue.city as any)?.name ?? "Venue"} · {venue.approved ? <span className="text-emerald-400">Live</span> : <span className="text-buzz-accent">Pending</span>}
            </p>
            <h1 className="h-display text-4xl sm:text-5xl">{venue.name}</h1>
          </div>
        </div>
        <div className="flex gap-2 flex-wrap">
          {venue.approved && (
            <Link
              href={`/${(venue.city as any)?.slug ?? "dundee"}/venues/${venue.slug}`}
              target="_blank"
              className="btn-secondary"
            >
              View public page ↗
            </Link>
          )}
          <Link href={`/dashboard/venues/${venue.id}/promote`} className="btn-secondary">📣 Promote</Link>
          <Link href={`/dashboard/venues/${venue.id}/edit`} className="btn-secondary">Edit venue</Link>
          <Link href={`/dashboard/venues/${venue.id}/events/upload-poster`} className="btn-secondary">📸 Upload poster</Link>
          <Link href={`/dashboard/venues/${venue.id}/events/paste-fixtures`} className="btn-secondary">📋 Paste fixtures</Link>
          {/* Admin-only: re-runs the FB scraper just for this venue when
              Dylan spots a gig poster on the venue's FB page that the
              cron hasn't picked up yet. Renders nothing for non-admins. */}
          <PullFacebookButton
            venueId={venue.id}
            facebookUrl={venue.facebook ?? null}
            isAdmin={isAdmin}
          />
          <Link href={`/dashboard/venues/${venue.id}/events/new`} className="btn-primary">+ Add event</Link>
        </div>
      </div>

      {!venue.approved ? (
        <div className="card p-4 border-buzz-accent/40 bg-buzz-accent/5 text-sm flex items-start gap-3">
          <span className="text-xl">⏳</span>
          <div>
            <div className="font-semibold text-buzz-accent">Awaiting admin approval</div>
            <div className="text-buzz-mute mt-0.5">
              Please continue to edit your venue details and add gigs as you like — your page won't appear publicly until we've approved it. We usually review within 24 hours.
            </div>
          </div>
        </div>
      ) : (
        <div className="card p-3 border-emerald-500/30 bg-emerald-500/5 text-sm flex items-start gap-3">
          <span className="text-base">✓</span>
          <div className="flex-1">
            <span className="font-semibold text-emerald-400">Admin approved</span>
            <span className="text-buzz-mute"> — your venue is live and your edits go straight to the public page.</span>
          </div>
        </div>
      )}

      {pendingGigs && pendingGigs.length > 0 && (
        <section>
          <h2 className="eyebrow mb-3 text-buzz-accent">
            🎟️ Pending approvals ({pendingGigs.length})
          </h2>
          <p className="text-sm text-buzz-mute mb-3">
            Artists have submitted these gigs at your venue. Approve to publish, reject if it's wrong.
          </p>
          <PendingGigsList gigs={pendingGigs as any} venueId={venue.id} />
        </section>
      )}

      <section>
        <h2 className="eyebrow mb-3">Upcoming gigs</h2>
        {upcoming && upcoming.length > 0 ? (
          <ul className="card divide-y divide-buzz-border/60">
            {upcoming.map((e) => (
              <li key={e.id} className="p-4 sm:p-5 flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <div className="text-xs text-buzz-accent font-bold uppercase tracking-wider">
                    {formatEventTime(e.start_time)}
                  </div>
                  <div className="font-display text-xl uppercase truncate mt-0.5">{e.title}</div>
                  {e.cover_charge && <div className="text-xs text-buzz-mute mt-0.5">{e.cover_charge}</div>}
                  {e.cancelled && (
                    <div className="inline-flex chip mt-2 bg-rose-600/20 text-rose-400 border-rose-600/40">
                      Cancelled
                    </div>
                  )}
                </div>
                <Link
                  href={`/dashboard/venues/${venue.id}/events/${e.id}/edit`}
                  className="btn-secondary shrink-0"
                >
                  Edit
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <div className="card p-10 text-center">
            <div className="text-4xl mb-3">🎸</div>
            <h3 className="font-display text-2xl uppercase mb-1">No gigs yet</h3>
            <p className="text-buzz-mute mb-5">Add your first one and start filling rooms.</p>
            <Link href={`/dashboard/venues/${venue.id}/events/new`} className="btn-primary">+ Add an event</Link>
          </div>
        )}
      </section>

      {venue.approved && (
        <section>
          <QRCodeCard
            url={`${process.env.NEXT_PUBLIC_SITE_URL || "https://thebuzzguide.co.uk"}/${(venue.city as any)?.slug ?? "dundee"}/venues/${venue.slug}`}
            label={venue.name}
            filenameBase={`the-buzz-${venue.slug}-qr`}
          />
        </section>
      )}

      {past && past.length > 0 && (
        <section>
          <h2 className="eyebrow mb-3">Past gigs</h2>
          <ul className="card divide-y divide-buzz-border/60 opacity-75">
            {past.map((e) => (
              <li key={e.id} className="p-3 px-4 flex items-center justify-between gap-4 text-sm">
                <div className="min-w-0">
                  <div className="text-[11px] text-buzz-mute uppercase tracking-wider">{formatEventTime(e.start_time)}</div>
                  <div className="truncate">{e.title}</div>
                </div>
                <Link
                  href={`/dashboard/venues/${venue.id}/events/${e.id}/edit`}
                  className="text-buzz-mute hover:text-buzz-accent text-xs"
                >
                  edit
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
