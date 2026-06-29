import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";
export const metadata = { title: "Claimed venues activity — The Buzz Kids admin" };

// Companion to the FB scrape "skip active claimed venues" rule (sql/059
// + cron filter). Shows every claimed venue ordered by oldest activity
// first, so admin can see at a glance who's gone quiet and may need a
// nudge to start adding events again. The cron silently falls back to
// scraping for venues quiet for 30+ days, but admin probably wants to
// reach out personally before that.

const OWNER_GRACE_DAYS = 30; // mirrors the cron's OWNER_GRACE_DAYS

type Row = {
  id: string;
  name: string;
  slug: string;
  citySlug: string | null;
  ownerEmail: string | null;
  ownerDisplayName: string | null;
  ownerId: string;
  lastEventAddedAt: string | null;
  lastFacebookScrape: string | null;
  facebook: string | null;
  approved: boolean;
};

export default async function ClaimedVenuesActivityPage() {
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

  // Service client — RLS would hide owner emails from non-owners on
  // profiles. Admin trust is verified above.
  const sb = createServiceClient();

  // Page through every claimed venue. Could be hundreds (Dundee + Fife
  // + Angus combined) so we page in 1000s. last_event_imported_at gets
  // sorted client-side after the fetch so NULL ("never any event") sorts
  // at the top.
  const PAGE = 1000;
  const venues: any[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data: page } = await sb
      .from("venues")
      .select(
        "id, name, slug, owner_id, last_event_imported_at, last_facebook_scrape, facebook, approved, city:cities(slug)",
      )
      .not("owner_id", "is", null)
      .range(from, from + PAGE - 1);
    if (!page || page.length === 0) break;
    venues.push(...page);
    if (page.length < PAGE) break;
  }

  // Look up owner emails in bulk.
  const ownerIds = Array.from(new Set(venues.map((v) => v.owner_id).filter(Boolean) as string[]));
  const ownerMap = new Map<string, { email: string | null; display_name: string | null }>();
  if (ownerIds.length > 0) {
    const CHUNK = 200;
    for (let i = 0; i < ownerIds.length; i += CHUNK) {
      const chunk = ownerIds.slice(i, i + CHUNK);
      const { data: profs } = await sb
        .from("profiles")
        .select("id, email, display_name")
        .in("id", chunk);
      for (const p of profs ?? []) {
        ownerMap.set(p.id, { email: p.email, display_name: p.display_name });
      }
    }
  }

  const rows: Row[] = venues.map((v: any) => ({
    id: v.id,
    name: v.name,
    slug: v.slug,
    citySlug: v.city?.slug ?? null,
    ownerEmail: v.owner_id ? ownerMap.get(v.owner_id)?.email ?? null : null,
    ownerDisplayName: v.owner_id ? ownerMap.get(v.owner_id)?.display_name ?? null : null,
    ownerId: v.owner_id,
    lastEventAddedAt: v.last_event_imported_at,
    lastFacebookScrape: v.last_facebook_scrape,
    facebook: v.facebook,
    approved: !!v.approved,
  }));

  // Sort: NULL last_event_imported_at first (never added anything), then
  // oldest activity ascending. Both groups are "the ones who need a
  // nudge"; the cron resumes scraping at the 30-day mark anyway, so the
  // listing's main purpose is letting admin reach out before that.
  rows.sort((a, b) => {
    if (!a.lastEventAddedAt && !b.lastEventAddedAt) return 0;
    if (!a.lastEventAddedAt) return -1;
    if (!b.lastEventAddedAt) return 1;
    return a.lastEventAddedAt.localeCompare(b.lastEventAddedAt);
  });

  const now = Date.now();
  const graceCutoff = now - OWNER_GRACE_DAYS * 24 * 60 * 60 * 1000;

  // Bucket counts for the at-a-glance summary at the top.
  let neverAdded = 0;
  let slacking = 0;
  let active = 0;
  for (const r of rows) {
    if (!r.lastEventAddedAt) {
      neverAdded++;
    } else {
      const ts = new Date(r.lastEventAddedAt).getTime();
      if (ts < graceCutoff) slacking++;
      else active++;
    }
  }

  return (
    <div className="container-page py-10 max-w-5xl">
      <Link href="/admin" className="text-sm text-buzz-mute hover:text-buzz-accent transition">
        ← Back to admin
      </Link>
      <p className="eyebrow mt-3 mb-1">Admin</p>
      <h1 className="h-display text-4xl sm:text-5xl mb-2">📊 Claimed venues activity</h1>
      <p className="text-buzz-mute mb-6 max-w-3xl">
        Every claimed venue, sorted by oldest activity first. Owners who have
        gone quiet for more than {OWNER_GRACE_DAYS} days fall back to the
        FB scraper as a safety net — but it&apos;s usually better to nudge
        them via email before that, otherwise duplicates start piling up
        once they come back.
      </p>

      <div className="grid grid-cols-3 gap-3 mb-6">
        <SummaryCard
          tone="rose"
          value={neverAdded}
          label="Never added"
          hint="No event ever logged"
        />
        <SummaryCard
          tone="amber"
          value={slacking}
          label={`Quiet ≥${OWNER_GRACE_DAYS}d`}
          hint="Scraper resumes"
        />
        <SummaryCard
          tone="emerald"
          value={active}
          label="Active"
          hint="Within grace window"
        />
      </div>

      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="text-xs uppercase tracking-wider text-buzz-mute border-b border-buzz-border">
            <tr>
              <th className="text-left p-3 font-medium">Venue</th>
              <th className="text-left p-3 font-medium">Owner</th>
              <th className="text-left p-3 font-medium">Last event added</th>
              <th className="text-left p-3 font-medium">FB scrape</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-buzz-border/60">
            {rows.map((r) => {
              const lastEventAge = r.lastEventAddedAt
                ? Math.floor((now - new Date(r.lastEventAddedAt).getTime()) / (24 * 60 * 60 * 1000))
                : null;
              const isSlacking = lastEventAge !== null && lastEventAge > OWNER_GRACE_DAYS;
              const isNever = lastEventAge === null;
              return (
                <tr key={r.id} className={isSlacking || isNever ? "bg-amber-500/5" : ""}>
                  <td className="p-3 min-w-0">
                    <div className="font-medium truncate flex items-center gap-2">
                      {r.approved ? (
                        r.citySlug ? (
                          <Link
                            href={`/${r.citySlug}/venues/${r.slug}`}
                            target="_blank"
                            className="hover:text-buzz-accent transition"
                          >
                            {r.name}
                          </Link>
                        ) : (
                          r.name
                        )
                      ) : (
                        <>
                          <span>{r.name}</span>
                          <span className="text-[10px] text-amber-400 uppercase tracking-wider">unapproved</span>
                        </>
                      )}
                    </div>
                    <div className="text-xs text-buzz-mute mt-0.5 flex gap-3 flex-wrap">
                      <Link
                        href={`/admin/events?q=${encodeURIComponent(r.name)}`}
                        className="hover:text-buzz-accent transition"
                      >
                        See events ↗
                      </Link>
                      {r.facebook && (
                        <a
                          href={r.facebook}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="hover:text-buzz-accent transition"
                        >
                          📘 FB ↗
                        </a>
                      )}
                    </div>
                  </td>
                  <td className="p-3 min-w-0">
                    <div className="text-xs">
                      {r.ownerDisplayName ?? <span className="text-buzz-mute italic">no name set</span>}
                    </div>
                    {r.ownerEmail && (
                      <a
                        href={`mailto:${r.ownerEmail}?subject=${encodeURIComponent(`Adding events at ${r.name}`)}`}
                        className="text-xs text-buzz-mute hover:text-buzz-accent transition truncate block max-w-[200px]"
                      >
                        {r.ownerEmail}
                      </a>
                    )}
                  </td>
                  <td className="p-3 whitespace-nowrap">
                    {isNever ? (
                      <span className="text-rose-400 text-xs font-medium">Never</span>
                    ) : (
                      <>
                        <div className={isSlacking ? "text-amber-400 text-xs font-medium" : "text-xs"}>
                          {lastEventAge === 0 ? "today" : lastEventAge === 1 ? "yesterday" : `${lastEventAge} days ago`}
                        </div>
                        <div className="text-[10px] text-buzz-mute">
                          {new Date(r.lastEventAddedAt!).toLocaleDateString("en-GB")}
                        </div>
                      </>
                    )}
                  </td>
                  <td className="p-3 whitespace-nowrap text-xs text-buzz-mute">
                    {r.lastFacebookScrape ? (
                      <>
                        {Math.floor((now - new Date(r.lastFacebookScrape).getTime()) / (24 * 60 * 60 * 1000))}d ago
                      </>
                    ) : (
                      <span className="italic">never</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {rows.length === 0 && (
          <div className="p-10 text-center text-buzz-mute text-sm">No claimed venues yet.</div>
        )}
      </div>
    </div>
  );
}

function SummaryCard({
  tone,
  value,
  label,
  hint,
}: {
  tone: "emerald" | "amber" | "rose";
  value: number;
  label: string;
  hint: string;
}) {
  const colourClasses = {
    emerald: "border-emerald-500/30 bg-emerald-500/5",
    amber: "border-amber-500/30 bg-amber-500/5",
    rose: "border-rose-500/30 bg-rose-500/5",
  }[tone];
  const valueClasses = {
    emerald: "text-emerald-400",
    amber: "text-amber-400",
    rose: "text-rose-400",
  }[tone];
  return (
    <div className={"card p-4 " + colourClasses}>
      <div className={"text-3xl font-display " + valueClasses}>{value}</div>
      <div className="text-xs font-medium mt-1">{label}</div>
      <div className="text-[10px] text-buzz-mute mt-0.5">{hint}</div>
    </div>
  );
}
