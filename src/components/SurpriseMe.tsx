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

// Slot-machine picker: whirls through the (filtered) places and decelerates to
// a stop on a random one. A thumbnail strip of the whole pool makes it obvious
// there are loads to choose from.
export default function SurpriseMe({ places }: { places: SurprisePlace[] }) {
  const [current, setCurrent] = useState<SurprisePlace | null>(places[0] ?? null);
  const [picked, setPicked] = useState<SurprisePlace | null>(null);
  const [spinning, setSpinning] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function spin() {
    if (timer.current) clearTimeout(timer.current);
    if (places.length === 0) return;
    setPicked(null);
    if (places.length === 1) {
      setCurrent(places[0]);
      setPicked(places[0]);
      return;
    }
    setSpinning(true);
    const totalTicks = 26 + Math.floor(Math.random() * 8);
    let tick = 0;
    let delay = 55;
    const run = () => {
      setCurrent(places[Math.floor(Math.random() * places.length)]);
      tick++;
      if (tick >= totalTicks) {
        const final = places[Math.floor(Math.random() * places.length)];
        setCurrent(final);
        setPicked(final);
        setSpinning(false);
        return;
      }
      if (tick > totalTicks * 0.65) delay = Math.min(delay * 1.22, 360);
      timer.current = setTimeout(run, delay);
    };
    run();
  }

  if (places.length === 0) {
    return <div className="card p-8 text-center text-buzz-mute">No places match those filters — try loosening them.</div>;
  }

  return (
    <div className="card p-6 sm:p-8">
      <p className="text-center text-sm text-buzz-mute mb-4">
        🎰 {places.length} place{places.length === 1 ? "" : "s"} in the mix
      </p>

      {/* Big reel window */}
      <div className="relative rounded-2xl overflow-hidden border border-buzz-border bg-buzz-surface aspect-[16/10]">
        {current && (
          <div
            className="absolute inset-0 flex flex-col justify-end p-5"
            style={
              current.photo
                ? { backgroundImage: `linear-gradient(to top, rgba(0,0,0,0.75), rgba(0,0,0,0.05)), url(${current.photo})`, backgroundSize: "cover", backgroundPosition: "center" }
                : { background: "linear-gradient(135deg,#1FA9E0,#EC1E8C)" }
            }
          >
            {current.category && (
              <span className="self-start text-[11px] font-bold uppercase tracking-wider text-white/90 mb-1">{current.category}</span>
            )}
            <div className="font-display text-3xl sm:text-4xl uppercase text-white leading-tight drop-shadow">{current.name}</div>
            <div className="text-sm text-white/90 mt-1 flex flex-wrap gap-x-3">
              <span>{current.cityName}</span>
              {current.age && <span>{current.age}</span>}
              {current.price && <span>{current.price}</span>}
            </div>
          </div>
        )}
        {spinning && <div className="absolute inset-0 ring-4 ring-inset ring-buzz-accent/50 animate-pulse pointer-events-none" />}
      </div>

      {/* Controls / result */}
      <div className="mt-5 flex flex-col items-center gap-3">
        <button onClick={spin} disabled={spinning} className="btn-primary btn-lg">
          {spinning ? "Finding something fun…" : picked ? "🎲 Spin again" : "🎲 Surprise me!"}
        </button>
        {picked && !spinning && (
          <Link href={`/${picked.citySlug}/venues/${picked.slug}`} className="text-buzz-accent hover:text-buzz-accent2 font-semibold">
            Take me to {picked.name} →
          </Link>
        )}
      </div>

      {/* Pool strip — shows the whole list it's choosing from. */}
      <div className="mt-6 flex gap-2 overflow-x-auto pb-1">
        {places.map((p) => (
          <div
            key={p.id}
            title={p.name}
            className={`shrink-0 w-14 h-14 rounded-lg bg-buzz-surface bg-cover bg-center border grid place-items-center ${current?.id === p.id ? "border-buzz-accent ring-2 ring-buzz-accent/40" : "border-buzz-border"}`}
            style={p.photo ? { backgroundImage: `url(${p.photo})` } : undefined}
          >
            {!p.photo && <span aria-hidden>🐝</span>}
          </div>
        ))}
      </div>
    </div>
  );
}
