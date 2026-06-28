import Link from "next/link";
import type { City } from "@/lib/types";

export default function CitySwitcher({ cities, current }: { cities: City[]; current?: string }) {
  const active = cities.filter((c) => c.active);
  const upcoming = cities.filter((c) => !c.active);
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <Link
          href="/browse"
          className={`filter-pill ${!current ? "filter-pill-active" : ""}`}
        >
          🗺️ All areas
        </Link>
        {active.map((c) => (
          <Link
            key={c.id}
            href={`/${c.slug}`}
            className={`filter-pill ${current === c.slug ? "filter-pill-active" : ""}`}
          >
            {c.name}
          </Link>
        ))}
      </div>
      {upcoming.length > 0 && (
        <span className="text-xs text-buzz-mute">
          Coming soon: {upcoming.map((c) => c.name).join(", ")}
        </span>
      )}
    </div>
  );
}
