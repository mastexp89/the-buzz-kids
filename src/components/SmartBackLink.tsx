"use client";

// "← Back" that returns to the exact page the visitor came from — the browse
// grid with their filters still applied, the city page, wherever — instead of
// always jumping to the city page. Falls back to a given href when there's no
// history to go back to (direct link / fresh tab).

import { useRouter } from "next/navigation";

export default function SmartBackLink({ fallbackHref }: { fallbackHref: string }) {
  const router = useRouter();
  function onClick(e: React.MouseEvent) {
    e.preventDefault();
    if (typeof window !== "undefined" && window.history.length > 1) router.back();
    else router.push(fallbackHref);
  }
  return (
    <a href={fallbackHref} onClick={onClick} className="text-sm text-buzz-mute hover:text-buzz-accent transition">
      ← Back
    </a>
  );
}
