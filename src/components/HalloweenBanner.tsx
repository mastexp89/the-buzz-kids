"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { HALLOWEEN } from "@/lib/halloween";

// Site-wide Halloween strip. The server only renders this while the season is
// active (see layout.tsx), so here we just handle the per-viewer dismiss and
// the festive look. Dismiss is remembered for the season.
const KEY = `hw_banner_${HALLOWEEN.season}`;

export default function HalloweenBanner() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    try {
      setShow(window.localStorage.getItem(KEY) !== "1");
    } catch {
      setShow(true);
    }
  }, []);

  if (!show) return null;

  function dismiss() {
    try {
      window.localStorage.setItem(KEY, "1");
    } catch {
      /* ignore */
    }
    setShow(false);
  }

  return (
    <div
      className="relative overflow-hidden text-white"
      style={{ background: "linear-gradient(90deg,#2A1248 0%,#140A24 45%,#3A1B0A 100%)" }}
    >
      {/* drifting bats */}
      <span className="hw-bat" style={{ left: "12%", animationDelay: "0s" }} aria-hidden>🦇</span>
      <span className="hw-bat" style={{ left: "46%", animationDelay: "1.1s" }} aria-hidden>🦇</span>
      <span className="hw-bat" style={{ left: "78%", animationDelay: "0.5s" }} aria-hidden>🦇</span>

      <div className="container-page py-2.5 flex items-center justify-center gap-3 text-center relative z-10">
        <Link href={`/browse?tab=events&when=${HALLOWEEN.day}`} className="group inline-flex items-center gap-2 text-sm sm:text-base font-bold">
          <span aria-hidden className="text-lg">🎃</span>
          Spooky season is here — find Halloween events &amp; days out near you
          <span aria-hidden className="inline-block group-hover:translate-x-1 transition">→</span>
        </Link>
      </div>

      <button
        onClick={dismiss}
        aria-label="Dismiss Halloween banner"
        className="absolute right-2 top-1/2 -translate-y-1/2 z-20 w-7 h-7 grid place-items-center rounded-full text-white/80 hover:text-white hover:bg-white/15 transition"
      >
        ✕
      </button>
    </div>
  );
}
