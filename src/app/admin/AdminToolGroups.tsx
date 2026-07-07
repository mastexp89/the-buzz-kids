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
  paid?: boolean; // renders a £ chip — this tool calls a paid API (Google/Apify/AI)
};

type Group = {
  title: string;
  tools: Tool[];
};

export default function AdminToolGroups({ pendingCount, suggestionsCount = 0 }: { pendingCount: number; suggestionsCount?: number }) {
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
          href: "/admin/suggestions",
          label: "Edit suggestions",
          emoji: "✏️",
          description: "Corrections & new-place requests from visitors",
          badge: suggestionsCount,
        },
        {
          href: "/admin/messages",
          label: "Messages & push",
          emoji: "📬",
          description: "Message users · 📢 broadcast with app push notifications",
        },
        {
          href: "/admin/events",
          label: "Sessions search",
          emoji: "🔎",
          description: "Find any session, edit or reassign",
        },
      ],
    },
    {
      title: "Add sessions",
      tools: [
        {
          href: "/admin/events/new",
          label: "Add event",
          emoji: "🎉",
          description: "A gala, fayre or special day — attach a place or leave standalone",
        },
        {
          href: "/admin/paste-event",
          label: "Paste from Facebook",
          emoji: "📋",
          description: "Paste a group post → AI pulls out the event to check & publish",
          paid: true,
        },
        {
          href: "/admin/quick-import",
          label: "Add from poster",
          emoji: "📸",
          description: "Drop a poster → AI fills the event; adds the place if new, or leave it with no place",
          paid: true,
        },
        {
          href: "/admin/import-site",
          label: "Import from website",
          emoji: "🌐",
          description: "Paste a URL or screenshots",
          paid: true,
        },
      ],
    },
    {
      title: "Directory",
      tools: [
        {
          href: "/admin/venues-manage",
          label: "Manage places",
          emoji: "🗂️",
          description: "Browse every place — photo, info, phone, website — edit or delete",
        },
        {
          href: "/admin/events-manage",
          label: "Manage events",
          emoji: "📆",
          description: "Browse every event — date, place, price — edit or delete",
        },
        {
          href: "/admin/offers",
          label: "Offers & deals",
          emoji: "🎟️",
          description: "Kids-eat-free & days-out deals for the Deals/Food tabs (no places added)",
          paid: true,
        },
        {
          href: "/admin/venues/new",
          label: "Add venue",
          emoji: "➕",
          description: "Manually create one venue (when Maps / OSM don't have it)",
          paid: true,
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
      ],
    },
    {
      title: "Ops",
      tools: [
        {
          href: "/admin/signups",
          label: "Coming-soon signups",
          emoji: "📧",
          description: "Pre-launch waitlist emails — copy or export to CSV",
        },
        {
          href: "/admin/broadcast",
          label: "Send a newsletter",
          emoji: "📣",
          description: "Email the waitlist / parents — launch news, updates (with unsubscribe)",
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
          href: "/admin/sponsors",
          label: "Sponsors",
          emoji: "💼",
          description: "Local family businesses running ads on the site",
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
                  {t.paid && (
                    <span
                      className={`${t.badge && t.badge > 0 ? "" : "ml-auto "}text-[10px] font-bold bg-amber-400/20 text-amber-600 rounded-full px-1.5 py-0.5 shrink-0`}
                      title="Uses a paid API (Google / AI) — small cost each time you use it"
                    >
                      £
                    </span>
                  )}
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
