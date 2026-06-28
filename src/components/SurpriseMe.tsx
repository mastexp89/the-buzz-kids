"use client";

import { useRef, useState } from "react";
import Link from "next/link";

export type SurprisePlace = {
  id: string;
  name: string;
  slug: string;
  citySlug: string;
  cityName: string;
  photo: string | null;
  category: string | null;
  age: string | null;
  price: string | null;
};

// Slot-machine picker: whirls through the (optionally area-filtered) places and
// decelerates to a stop on a random one. Pure client-side over a passed list.
export default function SurpriseMe({ places }: { places: SurprisePlace[] }) {
  const cities = Array.from(new Map(places.map((p) => [p.citySlug, p.cityName])).entries());

  const [area, setArea] = useState<string>(""); // "" = anywhere
  const [current, setCurrent] = useState<SurprisePlace | null>(places[0] ?? null);
  const [picked, setPicked] = useState<SurprisePlace | null>(null);
  const [spinning, setSpinning] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const pool = area ? places.filter((p) => p.citySlug === area) : places;

  function spin() {
    if (timer.current) clearTimeout(timer.current);
    if (pool.length === 0) return;
    setPicked(null);
    if (pool.length === 1) {
      setCurrent(pool[0]);
      setPicked(pool[0]);
      return;
    }
    setSpinning(true);
    const totalTicks = 26 + Math.floor(Math.random() * 8);
    let tick = 0;
    let delay = 55;
    const run = () => {
      setCurrent(pool[Math.floor(Math.random() * pool.length)]);
      tick++;
      if (tick >= totalTicks) {
        const final = pool[Math.floor(Math.random() * pool.length)];
        setCurrent(final);
        setPicked(final);
        setSpinning(false);
        return;
      }
      if (tick > totalTicks * 0.65) delay = Math.min(delay * 1.22, 360); // ease out
      timer.current = setTimeout(run, delay);
    };
    run();
  }

  function chooseArea(slug: string) {
    setArea(slug);
    setPicked(null);
  }

  return (
    <div className="card p-6 sm:p-8">
      {/* Area toggle */}
      <div className="flex flex-wrap justify-center gap-2 mb-5">
        <button onClick={() => chooseArea("")} className={area === "" ? "chip-accent" : "chip"} disabled={spinning}>
          Anywhere
        </button>
        {cities.map(([slug, name]) => (
          <button key={slug} onClick={() => chooseArea(slug)} className={area === slug ? "chip-accent" : "chip"} disabled={spinning}>
            {name}
          </button>
        ))}
      </div>

      {/* The "reel" window */}
      <div className="relative h-56 rounded-2xl overflow-hidden border border-buzz-border bg-buzz-surface">
        {current ? (
          <div
            className="absolute inset-0 flex flex-col justify-end p-5 transition-[background-image] duration-75"
            style={
              current.photo
                ? { backgroundImage: `linear-gradient(to top, rgba(0,0,0,0.7), rgba(0,0,0,0.05)), url(${current.photo})`, backgroundSize: "cover", backgroundPosition: "center" }
                : { background: "linear-gradient(135deg,#1FA9E0,#EC1E8C)" }
            }
          >
            {current.category && (
              <span className="self-start text-[11px] font-bold uppercase tracking-wider text-white/90 mb-1">{current.category}</span>
            )}
            <div className="font-display text-2xl sm:text-3xl uppercase text-white leading-tight drop-shadow">{current.name}</div>
            <div className="text-xs text-white/85 mt-1 flex flex-wrap gap-x-3">
              <span>{current.cityName}</span>
              {current.age && <span>{current.age}</span>}
              {current.price && <span>{current.price}</span>}
            </div>
          </div>
        ) : (
          <div className="absolute inset-0 grid place-items-center text-buzz-mute">No places to pick from yet.</div>
        )}
        {spinning && <div className="absolute inset-0 ring-4 ring-inset ring-buzz-accent/40 animate-pulse pointer-events-none" />}
      </div>

      {/* Controls / result */}
      <div className="mt-5 flex flex-col items-center gap-3">
        <button onClick={spin} disabled={spinning || pool.length === 0} className="btn-primary btn-lg">
          {spinning ? "Finding something fun…" : picked ? "🎲 Spin again" : "🎲 Surprise me!"}
        </button>
        {picked && !spinning && (
          <Link href={`/${picked.citySlug}/venues/${picked.slug}`} className="text-buzz-accent hover:text-buzz-accent2 font-semibold">
            Take me to {picked.name} →
          </Link>
        )}
      </div>
    </div>
  );
}
