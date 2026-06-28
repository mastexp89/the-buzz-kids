import Link from "next/link";
import type { City } from "@/lib/types";

export default function CitySwitcher({ cities, current }: { cities: City[]; current?: string }) {
  const active = cities.filter((c) => c.active);
  const upcoming = cities.filter((c) => !c.active);
  return (
    <div className="flex flex-wrap items-center gap-2">
      {active.map((c) => (
        <Link
          key={c.id}
          href={`/${c.slug}`}
          className={`chip ${current === c.slug ? "chip-accent" : ""}`}
        >
          {c.name}
        </Link>
      ))}
      {upcoming.length > 0 && (
        <span className="text-xs text-buzz-mute ml-2">
          Coming soon: {upcoming.map((c) => c.name).join(", ")}
        </span>
      )}
    </div>
  );
}
