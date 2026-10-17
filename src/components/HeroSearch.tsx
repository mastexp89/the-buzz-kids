"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// Hero location search — routes to the browse directory. Kept deliberately
// simple: a location box that drops the visitor into /browse to explore.
export default function HeroSearch() {
  const router = useRouter();
  const [q, setQ] = useState("");

  function go(e: React.FormEvent) {
    e.preventDefault();
    router.push(q.trim() ? `/browse?q=${encodeURIComponent(q.trim())}` : "/browse");
  }

  return (
    <form
      onSubmit={go}
      className="flex items-center gap-2 bg-white border border-buzz-border rounded-full p-1.5 pl-5 shadow-[0_10px_30px_-18px_rgba(22,32,42,0.35)] max-w-md"
    >
      <span className="text-buzz-pink text-lg" aria-hidden>📍</span>
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Enter a location (e.g. Edinburgh)"
        aria-label="Location"
        className="flex-1 min-w-0 bg-transparent outline-none font-semibold py-2 text-buzz-text placeholder-buzz-mute"
      />
      <button
        type="submit"
        aria-label="Search"
        className="w-11 h-11 rounded-full bg-buzz-accent text-white grid place-items-center text-lg shrink-0 hover:bg-buzz-accent2 transition"
      >
        →
      </button>
    </form>
  );
}
