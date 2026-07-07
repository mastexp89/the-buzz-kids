"use client";

import { ReactNode } from "react";

type Props = {
  href: string;
  kind: string; // see ALLOWED_KINDS in /api/track
  venueId?: string;
  artistId?: string;
  eventId?: string;
  source?: string; // where on the site the link lives (e.g. "footer")
  children: ReactNode;
  className?: string;
  target?: string;
  rel?: string;
  title?: string;
  ariaLabel?: string;
  onClickAlso?: () => void;
};

/**
 * Anchor that fires a click-tracking beacon on click without delaying nav.
 * Uses navigator.sendBeacon when available (most reliable for "fire and run"),
 * falls back to fetch with keepalive: true.
 */
export default function TrackedLink({
  href,
  kind,
  venueId,
  artistId,
  eventId,
  source,
  children,
  className,
  target,
  rel,
  title,
  ariaLabel,
  onClickAlso,
}: Props) {
  function fire() {
    try {
      const payload = JSON.stringify({ kind, venueId, artistId, eventId, source });
      if (typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
        const blob = new Blob([payload], { type: "application/json" });
        navigator.sendBeacon("/api/track", blob);
      } else if (typeof fetch !== "undefined") {
        fetch("/api/track", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: payload,
          keepalive: true,
        }).catch(() => {});
      }
    } catch {
      // Never let analytics break a click
    }
  }

  return (
    <a
      href={href}
      className={className}
      target={target}
      rel={rel}
      title={title}
      aria-label={ariaLabel}
      onClick={() => {
        fire();
        if (onClickAlso) onClickAlso();
      }}
      onAuxClick={fire} /* fire on middle-click / open in new tab too */
    >
      {children}
    </a>
  );
}
