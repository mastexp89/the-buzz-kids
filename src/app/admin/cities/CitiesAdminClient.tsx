"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { setCityActive } from "./actions";

type CityRow = {
  id: string;
  name: string;
  slug: string;
  active: boolean;
  nearbyAreas: string[];
  venueCount: number;
};

export default function CitiesAdminClient({ initialCities }: { initialCities: CityRow[] }) {
  const router = useRouter();
  const [cities, setCities] = useState(initialCities);
  const [busySlug, setBusySlug] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  function toggle(c: CityRow) {
    const nextActive = !c.active;
    if (
      nextActive === false &&
      !confirm(
        `Hide ${c.name} from the public site?\n\n` +
          `- /${c.slug} will 404\n` +
          `- ${c.name} disappears from navbar, footer, and homepage\n` +
          `- ${c.venueCount} venues stay in the database, just hidden\n\n` +
          `You can flip it back on any time.`,
      )
    ) {
      return;
    }
    setError(null);
    setBusySlug(c.slug);
    // Optimistic update so the UI flips immediately.
    setCities((cs) => cs.map((x) => (x.slug === c.slug ? { ...x, active: nextActive } : x)));
    startTransition(async () => {
      const res = await setCityActive(c.slug, nextActive);
      setBusySlug(null);
      if ("error" in res) {
        setError(res.error);
        // Revert optimistic update on error.
        setCities((cs) => cs.map((x) => (x.slug === c.slug ? { ...x, active: c.active } : x)));
        return;
      }
      router.refresh();
    });
  }

  return (
    <div>
      {error && (
        <div className="card p-3 mb-4 text-sm text-rose-400 border-rose-500/40">
          {error}
        </div>
      )}

      <ul className="card divide-y divide-buzz-border/60">
        {cities.map((c) => (
          <li
            key={c.slug}
            className="p-4 flex flex-col sm:flex-row sm:items-center gap-3"
          >
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-0.5">
                <span className="font-display text-lg uppercase truncate">
                  {c.name}
                </span>
                {c.active ? (
                  <span className="text-[10px] uppercase tracking-wide bg-emerald-500/20 text-emerald-400 px-2 py-0.5 rounded">
                    Live
                  </span>
                ) : (
                  <span className="text-[10px] uppercase tracking-wide bg-buzz-mute/20 text-buzz-mute px-2 py-0.5 rounded">
                    Hidden
                  </span>
                )}
              </div>
              <div className="text-xs text-buzz-mute">
                /{c.slug} · {c.venueCount} venue{c.venueCount === 1 ? "" : "s"}
                {c.nearbyAreas.length > 0 && (
                  <> · covers {c.nearbyAreas.length} town{c.nearbyAreas.length === 1 ? "" : "s"}</>
                )}
              </div>
              {c.nearbyAreas.length > 0 && (
                <div className="text-xs text-buzz-mute/70 truncate">
                  {c.nearbyAreas.join(", ")}
                </div>
              )}
            </div>

            <div className="flex items-center gap-3 shrink-0">
              {c.active && (
                <Link
                  href={`/${c.slug}`}
                  target="_blank"
                  className="text-xs text-buzz-mute hover:text-buzz-accent"
                >
                  View ↗
                </Link>
              )}
              <button
                type="button"
                onClick={() => toggle(c)}
                disabled={busySlug === c.slug}
                aria-pressed={c.active}
                title={c.active ? `Hide ${c.name} from the public site` : `Make ${c.name} live on the public site`}
                className={
                  "relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full transition-colors " +
                  (c.active ? "bg-buzz-accent" : "bg-buzz-card border border-buzz-border") +
                  (busySlug === c.slug ? " opacity-60 cursor-wait" : "")
                }
              >
                <span
                  className={
                    "inline-block h-5 w-5 rounded-full bg-buzz-bg shadow transform transition-transform " +
                    (c.active ? "translate-x-[22px]" : "translate-x-0.5") +
                    " mt-0.5"
                  }
                />
              </button>
            </div>
          </li>
        ))}
      </ul>

      <p className="text-xs text-buzz-mute mt-4">
        Tip: hide a city while you bulk-add venues + populate events, then flip
        it on once it's ready. Public site won't hint that the region exists
        until you flip the switch.
      </p>
    </div>
  );
}
