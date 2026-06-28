"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";

// Segmented control switching a town page between the always-on Places
// directory and the dated What's-on events feed. Places is the default
// (no ?view param); What's on sets ?view=whatson. Other params (filters)
// are preserved across the switch.
export default function CityViewToggle({ view }: { view: "places" | "whatson" }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  function go(v: "places" | "whatson") {
    const sp = new URLSearchParams(params);
    if (v === "places") sp.delete("view");
    else sp.set("view", v);
    router.push(`${pathname}?${sp.toString()}`);
  }

  const base = "px-5 py-2.5 rounded-full text-sm font-semibold transition";
  const on = "bg-buzz-accent text-white";
  const off = "text-buzz-text hover:bg-buzz-card";

  return (
    <div className="inline-flex gap-1 p-1 rounded-full bg-buzz-surface border border-buzz-border">
      <button onClick={() => go("places")} className={`${base} ${view === "places" ? on : off}`}>
        Places to go
      </button>
      <button onClick={() => go("whatson")} className={`${base} ${view === "whatson" ? on : off}`}>
        What's on
      </button>
    </div>
  );
}
