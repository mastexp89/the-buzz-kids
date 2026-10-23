// Seasonal Halloween treatment — a site-wide banner + spooky effects on
// Halloween events. Auto-on during the window below, so it appears and
// disappears on its own each year; just bump the dates for next season.

export const HALLOWEEN = {
  // Inclusive window the banner + card effects show in (UK time). Ends the
  // morning after Halloween so late-night 31 Oct events still get the magic.
  from: "2026-10-20T00:00:00+01:00",
  to: "2026-11-01T06:00:00+00:00",
  // Bump this when you change the window so a new dismissible banner shows
  // again (the dismiss is remembered per season).
  season: "2026",
  // Halloween day itself — the banner's "find Halloween events" link lands on
  // this date in What's On.
  day: "2026-10-31",
};

/** Are we inside the Halloween window right now? */
export function halloweenActive(now: Date = new Date()): boolean {
  const t = now.getTime();
  return t >= new Date(HALLOWEEN.from).getTime() && t <= new Date(HALLOWEEN.to).getTime();
}

const SPOOKY_RE =
  /hallowe?en|spooky|spook|pumpkin|ghost|ghoul|witch|haunt|trick[- ]?or[- ]?treat|fright|scare|monster|zombie|graveyard|cobweb|skeleton|fancy dress/i;

/**
 * Is this a Halloween event? True when the title/description mentions it, or
 * it falls on the Halloween run (28 Oct – 1 Nov, any year).
 */
export function isHalloweenEvent(e: {
  title?: string | null;
  description?: string | null;
  start_time?: string | null;
}): boolean {
  const text = `${e.title ?? ""} ${e.description ?? ""}`;
  if (SPOOKY_RE.test(text)) return true;
  const d = e.start_time ? new Date(e.start_time) : null;
  if (d && !Number.isNaN(d.getTime())) {
    const m = d.getMonth(); // 9 = October, 10 = November
    const day = d.getDate();
    if ((m === 9 && day >= 28) || (m === 10 && day === 1)) return true;
  }
  return false;
}
