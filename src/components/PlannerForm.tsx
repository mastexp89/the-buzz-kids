"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Genre } from "@/lib/types";
import { ACCESS_FACETS } from "@/lib/accessibility";

const CHIP_COLOURS = [
  { solid: "#EC1E8C", on: "#fff", tintBg: "#FBE0EC", tintText: "#A3174F" },
  { solid: "#1FA9E0", on: "#fff", tintBg: "#DCF1FA", tintText: "#0C6087" },
  { solid: "#6FA713", on: "#fff", tintBg: "#E6F6E0", tintText: "#3B6D11" },
  { solid: "#F9A11B", on: "#1F1B16", tintBg: "#FFEDC2", tintText: "#854F0B" },
];
function chip(i: number, active: boolean): React.CSSProperties {
  const c = CHIP_COLOURS[i % CHIP_COLOURS.length];
  return active
    ? { backgroundColor: c.solid, color: c.on, borderColor: c.solid }
    : { backgroundColor: c.tintBg, color: c.tintText, borderColor: "transparent" };
}

export type PlannerInitial = {
  age: string;
  budget: string;   // "" | "free" | "20"
  setting: string;  // "" | "indoor" | "outdoor"
  cats: string[];
  access: string[];
  loc: string;
};

export default function PlannerForm({
  genres,
  cities,
  initial,
}: {
  genres: Genre[];
  cities: { name: string; slug: string }[];
  initial: PlannerInitial;
}) {
  const router = useRouter();
  const [age, setAge] = useState(initial.age);
  const [budget, setBudget] = useState(initial.budget);
  const [setting, setSetting] = useState(initial.setting);
  const [cats, setCats] = useState<string[]>(initial.cats);
  const [access, setAccess] = useState<string[]>(initial.access);
  const [loc, setLoc] = useState(initial.loc);

  const toggle = (list: string[], v: string, set: (x: string[]) => void) =>
    set(list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const sp = new URLSearchParams();
    if (age) sp.set("age", age);
    if (budget) sp.set("budget", budget);
    if (setting) sp.set("setting", setting);
    if (cats.length) sp.set("cat", cats.join(","));
    if (access.length) sp.set("access", access.join(","));
    if (loc) sp.set("loc", loc);
    sp.set("go", "1");
    router.push(`/plan?${sp.toString()}`);
  }

  const seg = (active: boolean) => (active ? "chip-accent" : "chip");

  return (
    <form onSubmit={submit} className="card p-6 flex flex-col gap-6">
      <div className="grid sm:grid-cols-2 gap-6">
        <div>
          <label className="label">How old are they?</label>
          <input
            type="number" min={0} max={17} value={age}
            onChange={(e) => setAge(e.target.value)}
            placeholder="Youngest age, e.g. 4"
            className="input max-w-[180px]"
          />
          <p className="help">We'll show places that suit them.</p>
        </div>
        <div>
          <div className="label">Where?</div>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => setLoc("")} className={seg(loc === "")}>Anywhere</button>
            {cities.map((c) => (
              <button type="button" key={c.slug} onClick={() => setLoc(loc === c.slug ? "" : c.slug)} className={seg(loc === c.slug)}>{c.name}</button>
            ))}
          </div>
        </div>
      </div>

      <div className="grid sm:grid-cols-2 gap-6">
        <div>
          <div className="label">Budget</div>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => setBudget(budget === "free" ? "" : "free")} className={seg(budget === "free")}>Free only</button>
            <button type="button" onClick={() => setBudget(budget === "20" ? "" : "20")} className={seg(budget === "20")}>Under £20</button>
            <button type="button" onClick={() => setBudget("")} className={seg(budget === "")}>Any</button>
          </div>
        </div>
        <div>
          <div className="label">Indoors or out?</div>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => setSetting(setting === "indoor" ? "" : "indoor")} className={seg(setting === "indoor")}>🌧️ Indoors</button>
            <button type="button" onClick={() => setSetting(setting === "outdoor" ? "" : "outdoor")} className={seg(setting === "outdoor")}>☀️ Outdoors</button>
            <button type="button" onClick={() => setSetting("")} className={seg(setting === "")}>Either</button>
          </div>
        </div>
      </div>

      <div>
        <div className="label">What are they into?</div>
        <div className="flex flex-wrap gap-2">
          {genres.map((g, i) => (
            <button type="button" key={g.id} onClick={() => toggle(cats, g.slug, setCats)} style={chip(i, cats.includes(g.slug))} className="chip">
              {g.name}
            </button>
          ))}
        </div>
      </div>

      <div>
        <div className="label">Any access or sensory needs?</div>
        <div className="flex flex-wrap gap-2">
          {ACCESS_FACETS.map((f) => (
            <button type="button" key={f.key} onClick={() => toggle(access, f.key, setAccess)} className={access.includes(f.key) ? "chip-accent" : "chip"}>
              <span aria-hidden className="mr-1">{f.icon}</span>{f.label}
            </button>
          ))}
        </div>
      </div>

      <button type="submit" className="btn-primary btn-lg self-start">Find their buzz →</button>
    </form>
  );
}
