import Link from "next/link";

// Single visual style for every admin tool tile so the page reads as
// "here are 14 places you can go" instead of "5 important things and 9
// less important things" (which the old btn-primary/btn-secondary split
// implied without any actual difference in importance).
//
// Section headers do the grouping work — colour is reserved for badges
// (e.g. pending-count on Approval queue) so something orange always
// means "you have things waiting".

type Tool = {
  href: string;
  label: string;
  emoji: string;
  description?: string;
  badge?: number; // when > 0, rendered as an orange pill on the tile
};

type Group = {
  title: string;
  tools: Tool[];
};

export default function AdminToolGroups({ pendingCount }: { pendingCount: number }) {
  const groups: Group[] = [
    {
      title: "Moderation",
      tools: [
        {
          href: "/admin/queue",
          label: "Approval queue",
          emoji: "✅",
          description: "Pending place / organiser claims & sessions",
          badge: pendingCount,
        },
        {
          href: "/admin/reviews",
          label: "Reviews",
          emoji: "⭐",
          description: "Approve or hide parent reviews",
        },
        {
          href: "/admin/events",
          label: "Sessions search",
          emoji: "🔎",
          description: "Find any session, edit or reassign",
        },
        {
          href: "/admin/messages",
          label: "Messages",
          emoji: "📬",
          description: "Threads with place owners & organisers",
        },
      ],
    },
    {
      title: "Add sessions",
      tools: [
        {
          href: "/admin/quick-import",
          label: "Quick import",
          emoji: "⚡",
          description: "Drop a poster, AI extracts the session",
        },
        {
          href: "/admin/import-site",
          label: "Import from website",
          emoji: "🌐",
          description: "Paste a URL or screenshots",
        },
        {
          href: "/admin/extract-events",
          label: "FB scrape (manual)",
          emoji: "🤖",
          description: "Run the FB extractor on demand",
        },
      ],
    },
    {
      title: "Directory",
      tools: [
        {
          href: "/admin/venues/new",
          label: "Add venue",
          emoji: "➕",
          description: "Manually create one venue (when Maps / OSM don't have it)",
        },
        {
          href: "/admin/discover-venues",
          label: "Discover venues",
          emoji: "🗺️",
          description: "Auto-find places across a region via Google Maps",
        },
        {
          href: "/admin/venues-enrich",
          label: "Enrich venues",
          emoji: "🌍",
          description: "Fill missing address / coords / website from OSM",
        },
        {
          href: "/admin/venues-photos-hours",
          label: "Photos & hours",
          emoji: "📸",
          description: "Pull 6 photos + opening hours from Google Maps",
        },
        {
          href: "/admin/venues-facebook",
          label: "Venue FB URLs",
          emoji: "📘",
          description: "Bulk-fill the FB URL on each venue",
        },
        {
          href: "/admin/venue-outreach",
          label: "Invite via Messenger",
          emoji: "📩",
          description: "DM unclaimed venues to take their page",
        },
        {
          href: "/admin/venues-dedupe",
          label: "Dedupe venues",
          emoji: "🧹",
          description: "Merge 'X' / 'The X' duplicates safely",
        },
        {
          href: "/admin/events-dedupe",
          label: "Dedupe events",
          emoji: "🧹",
          description: "Merge same-day duplicate sessions",
        },
        {
          href: "/admin/venue-slug-cleanup",
          label: "Clean venue slugs",
          emoji: "🧼",
          description: "Strip random suffixes from old import URLs",
        },
      ],
    },
    {
      title: "Ops",
      tools: [
        {
          href: "/admin/activity-log",
          label: "Activity log",
          emoji: "📜",
          description: "Recent edits by places and organisers",
        },
        {
          href: "/admin/claimed-venues",
          label: "Claimed venues activity",
          emoji: "📊",
          description: "Who's added events recently · who needs a nudge",
        },
        {
          href: "/admin/favourites",
          label: "Favourites",
          emoji: "♥",
          description: "Who's loved what — top places and sessions",
        },
        {
          href: "/admin/cities",
          label: "Cities",
          emoji: "🏙️",
          description: "Toggle a region public / hidden",
        },
        {
          href: "/admin/cron-runs",
          label: "Cron runs",
          emoji: "⏱️",
          description: "Daily output + run-now triggers",
        },
        {
          href: "/admin/analytics",
          label: "Analytics",
          emoji: "📊",
          description: "Page views & top venues",
        },
        {
          href: "/admin/promotions",
          label: "Promotions",
          emoji: "🚀",
          description: "Live spotlights & boosts",
        },
        {
          href: "/admin/sponsors",
          label: "Sponsors",
          emoji: "💼",
          description: "Local ad clients (takeaways, taxis)",
        },
      ],
    },
  ];

  return (
    <div className="mb-10 flex flex-col gap-5">
      {groups.map((g) => (
        <div key={g.title}>
          <p className="text-xs uppercase tracking-wider text-buzz-mute mb-2">{g.title}</p>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
            {g.tools.map((t) => (
              <Link
                key={t.href}
                href={t.href}
                className="group rounded-lg border border-buzz-border bg-buzz-card hover:border-buzz-accent transition px-3 py-2.5 flex flex-col gap-0.5 min-w-0"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span aria-hidden className="text-base shrink-0">
                    {t.emoji}
                  </span>
                  <span className="font-medium truncate group-hover:text-buzz-accent transition">
                    {t.label}
                  </span>
                  {t.badge && t.badge > 0 ? (
                    <span className="ml-auto text-[10px] font-bold bg-buzz-accent text-buzz-bg rounded-full px-1.5 py-0.5 shrink-0">
                      {t.badge}
                    </span>
                  ) : null}
                </div>
                {t.description && (
                  <p className="text-xs text-buzz-mute truncate">{t.description}</p>
                )}
              </Link>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
