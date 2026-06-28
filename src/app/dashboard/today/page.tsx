import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getMyFavouriteEventsInWindow, type PlannerEvent } from "@/lib/favourites";
import DayPlannerMap from "@/components/DayPlannerMapWrapper";

export const dynamic = "force-dynamic";
export const metadata = { title: "Day planner — The Buzz Guide" };

type Tab = "today" | "tomorrow" | "week" | "all";

type Props = { searchParams: Promise<{ tab?: string }> };

function dayWindowLondon(offsetDays: number, durationDays = 1): { startIso: string; endIso: string } {
  // Build a Europe/London date string for "today + offsetDays", then construct
  // ISO UTC stamps for the start and end of that window. We use the same
  // technique the morning-of cron uses.
  const now = new Date();
  const todayLondon = now.toLocaleDateString("en-CA", { timeZone: "Europe/London" });
  const start = new Date(`${todayLondon}T00:00:00+00:00`);
  start.setUTCDate(start.getUTCDate() + offsetDays);
  const end = new Date(start.getTime() + durationDays * 24 * 60 * 60 * 1000);
  return { startIso: start.toISOString(), endIso: end.toISOString() };
}

export default async function DayPlannerPage({ searchParams }: Props) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/dashboard/today");

  const sp = await searchParams;
  const tab = (
    sp.tab === "tomorrow" || sp.tab === "week" || sp.tab === "all"
      ? sp.tab
      : "today"
  ) as Tab;

  let windowFor: { startIso: string; endIso: string };
  let tabLabel: string;
  if (tab === "today") {
    // From now until end of today London (so past events drop off as the day goes on)
    const t = dayWindowLondon(0, 1);
    windowFor = { startIso: new Date().toISOString(), endIso: t.endIso };
    tabLabel = "Today";
  } else if (tab === "tomorrow") {
    windowFor = dayWindowLondon(1, 1);
    tabLabel = "Tomorrow";
  } else if (tab === "week") {
    // "This week" = day after tomorrow through end of day +7
    windowFor = dayWindowLondon(2, 6); // 6 days starting day-after-tomorrow
    tabLabel = "Rest of the week";
  } else {
    // "All" — everything they've favourited that hasn't started yet,
    // out to 2 years. Generous so future festival gigs stay visible.
    const now = new Date();
    const farFuture = new Date(now.getTime() + 730 * 24 * 60 * 60 * 1000);
    windowFor = { startIso: now.toISOString(), endIso: farFuture.toISOString() };
    tabLabel = "All upcoming";
  }

  const events = await getMyFavouriteEventsInWindow(
    windowFor.startIso,
    windowFor.endIso,
  );

  // Pre-fetch tab badge counts in parallel so the user can see "how many"
  // before clicking each tab. When the current tab matches one of these,
  // we already have the result — just reuse `events`.
  const [todayCount, tomorrowCount, weekCount, allCount] = await Promise.all([
    tab === "today"
      ? Promise.resolve(events.length)
      : (async () => {
          const t = dayWindowLondon(0, 1);
          const e = await getMyFavouriteEventsInWindow(new Date().toISOString(), t.endIso);
          return e.length;
        })(),
    tab === "tomorrow"
      ? Promise.resolve(events.length)
      : (async () => {
          const w = dayWindowLondon(1, 1);
          const e = await getMyFavouriteEventsInWindow(w.startIso, w.endIso);
          return e.length;
        })(),
    tab === "week"
      ? Promise.resolve(events.length)
      : (async () => {
          const w = dayWindowLondon(2, 6);
          const e = await getMyFavouriteEventsInWindow(w.startIso, w.endIso);
          return e.length;
        })(),
    tab === "all"
      ? Promise.resolve(events.length)
      : (async () => {
          const now = new Date();
          const farFuture = new Date(now.getTime() + 730 * 24 * 60 * 60 * 1000);
          const e = await getMyFavouriteEventsInWindow(
            now.toISOString(),
            farFuture.toISOString(),
          );
          return e.length;
        })(),
  ]);

  return (
    <div className="flex flex-col gap-4 max-w-3xl">
      <div>
        <p className="eyebrow mb-1">My account</p>
        <h1 className="h-display text-4xl">📍 Day planner</h1>
        <p className="text-buzz-mute mt-2 text-sm max-w-xl">
          Your favourite gigs ordered chronologically with a map of the venues.
          Use this to plan your route through a festival day, or check what
          you&apos;ve got on this week.
        </p>
      </div>

      <div className="flex flex-wrap gap-2 border-b border-buzz-border/60 pb-2">
        <TabLink active={tab === "today"} href="/dashboard/today?tab=today" label={`Today (${todayCount})`} />
        <TabLink active={tab === "tomorrow"} href="/dashboard/today?tab=tomorrow" label={`Tomorrow (${tomorrowCount})`} />
        <TabLink active={tab === "week"} href="/dashboard/today?tab=week" label={`Rest of week (${weekCount})`} />
        <TabLink active={tab === "all"} href="/dashboard/today?tab=all" label={`All (${allCount})`} />
      </div>

      {events.length === 0 ? (
        <div className="card p-10 text-center">
          <div className="text-5xl mb-3">📭</div>
          <h2 className="font-display text-2xl mb-2">Nothing for {tabLabel.toLowerCase()}</h2>
          <p className="text-buzz-mute text-sm max-w-md mx-auto">
            You haven&apos;t favourited any gigs in this window. Heart anything
            on the city or venue pages and it&apos;ll show up here automatically.
          </p>
          <Link href="/" className="btn-secondary mt-6 inline-block">
            Browse what&apos;s on
          </Link>
        </div>
      ) : (
        <>
          <DayPlannerMap events={events} />

          <ul className="card divide-y divide-buzz-border/60">
            {events.map((e, idx) => (
              <PlannerRow key={e.id} event={e} sequence={idx + 1} />
            ))}
          </ul>
        </>
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

function PlannerRow({ event, sequence }: { event: PlannerEvent; sequence: number }) {
  const startDate = new Date(event.start_time);
  const startTime = startDate.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/London",
  });
  const endTime = event.end_time
    ? new Date(event.end_time).toLocaleTimeString("en-GB", {
        hour: "2-digit",
        minute: "2-digit",
        timeZone: "Europe/London",
      })
    : null;
  const dayLabel = startDate.toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "Europe/London",
  });

  return (
    <li className="p-4 flex items-start gap-3">
      <div
        className="w-8 h-8 rounded-full bg-buzz-accent text-black grid place-items-center font-bold shrink-0"
        aria-hidden
      >
        {sequence}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex flex-wrap items-center gap-2 text-xs text-buzz-mute">
          <span className="font-medium text-buzz-fg">{dayLabel}</span>
          <span>·</span>
          <span>
            {startTime}
            {endTime && ` – ${endTime}`}
          </span>
        </div>
        <Link
          href={event.venue.citySlug ? `/${event.venue.citySlug}/events/${event.id}` : "#"}
          className="block font-display text-xl uppercase leading-tight mt-1 hover:text-buzz-accent transition"
        >
          {event.title}
        </Link>
        <div className="text-sm text-buzz-mute mt-0.5">
          at {event.venue.name}
          {event.venue.address && (
            <span className="text-buzz-mute/70"> · {event.venue.address}</span>
          )}
        </div>
      </div>
    </li>
  );
}
