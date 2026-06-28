import { format, parseISO } from "date-fns";

/**
 * Pick a thumbnail icon for an event when no real poster is on file.
 * Driven by the event's genre tags first (most reliable), then a title
 * heuristic for cases without a genre, finally a neutral 🎟️ — never
 * falsely assume "music" for things like community dance.
 *
 * Add new slugs here when the genres table grows.
 */
export function pickEventIcon(
  title: string,
  genreSlugs: string[],
): string {
  const tags = new Set(genreSlugs.map((s) => s.toLowerCase()));
  const t = (title || "").toLowerCase();

  // Genre-based (most reliable signal)
  if (tags.has("sports")) return "📺";
  if (tags.has("karaoke") || tags.has("open-mic")) return "🎤";
  if (tags.has("tribute") || tags.has("covers") || tags.has("tribute-covers")) return "🎤";
  if (tags.has("comedy") || tags.has("stand-up")) return "🎭";
  if (tags.has("quiz")) return "🧠";
  if (tags.has("bingo")) return "🔢";
  if (tags.has("dj") || tags.has("electronic") || tags.has("house") || tags.has("techno") || tags.has("drum-and-bass") || tags.has("hip-hop")) return "🎧";
  if (tags.has("folk") || tags.has("traditional") || tags.has("trad") || tags.has("ceilidh")) return "🪕";
  if (tags.has("jazz") || tags.has("blues")) return "🎷";
  if (tags.has("dance")) return "💃";
  // Generic live-music genres
  if (
    tags.has("rock") || tags.has("pop") || tags.has("indie") ||
    tags.has("metal") || tags.has("punk") || tags.has("acoustic") ||
    tags.has("country") || tags.has("classical") || tags.has("singer-songwriter") ||
    tags.has("live-music")
  ) return "♪";

  // Title-based heuristic for events without a useful genre tag
  if (/live\s*sports|sports\s*[—-]| v(?:s\.?)? |football|premier league|champions league|nfl|nba|rugby|tennis|golf|cricket|formula\s*1|\bf1\b/.test(t)) return "📺";
  if (/karaoke/.test(t)) return "🎤";
  if (/open\s*mic/.test(t)) return "🎤";
  if (/tribute|cover band/.test(t)) return "🎤";
  if (/comedy|stand[\s-]up/.test(t)) return "🎭";
  if (/quiz/.test(t)) return "🧠";
  if (/bingo/.test(t)) return "🔢";
  if (/\bdj\b/.test(t)) return "🎧";
  if (/dance/.test(t)) return "💃";
  if (/live music|gig\b|acoustic|band\b/.test(t)) return "♪";

  // Fallback: neutral event ticket, NOT a music note — we don't know if
  // it's music, and assuming music is misleading for community events.
  return "🎟️";
}

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/['']/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 80);
}

/** Returns the English ordinal suffix for a day-of-month number (1 → "st", 2 → "nd"...). */
export function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return s[(v - 20) % 10] || s[v] || s[0];
}

// Why these wrappers exist: this file runs in BOTH the browser (client
// components) AND on the Vercel server (server components, route
// handlers). The browser is in UK local time so date-fns' format()
// renders correctly. The Vercel server is in UTC so the same format()
// call shows times 1h early during BST — a venue typing "19:00" sees
// the listing card show "6pm" while the event detail page (a client
// component) shows "7pm". These wrappers force Europe/London regardless
// of where the code runs.

// Returns the wall-clock components of a UTC instant interpreted in
// Europe/London. Used as the basis for every London-aware formatter.
function londonParts(iso: string | Date): {
  year: number; month: number; day: number;
  hour: number; minute: number; weekday: string;
  ymd: string;
} {
  const d = iso instanceof Date ? iso : parseISO(iso);
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", weekday: "long",
    hour12: false,
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const year = parseInt(get("year"), 10);
  const month = parseInt(get("month"), 10);
  const day = parseInt(get("day"), 10);
  // Intl returns "24" for midnight in some locales; normalise to 0
  // so subsequent comparisons behave.
  let hour = parseInt(get("hour"), 10);
  if (hour === 24) hour = 0;
  const minute = parseInt(get("minute"), 10);
  const weekday = get("weekday");
  const pad = (n: number) => String(n).padStart(2, "0");
  const ymd = `${year}-${pad(month)}-${pad(day)}`;
  return { year, month, day, hour, minute, weekday, ymd };
}

// "7pm" / "7:30pm" — the existing UI convention. Hour-only times drop
// the ":00" so a 19:00 start reads cleanly.
function formatLondonTime(d: Date | string): string {
  const p = londonParts(d);
  const h12 = ((p.hour + 11) % 12) + 1;
  const ampm = p.hour < 12 ? "am" : "pm";
  return p.minute === 0 ? `${h12}${ampm}` : `${h12}:${String(p.minute).padStart(2, "0")}${ampm}`;
}

// London-aware date comparisons. The old isToday/isTomorrow/isThisWeek
// from date-fns compared against the SERVER's local date (UTC on Vercel),
// which during BST evening hours puts London's "today" into UTC's
// "yesterday" — so a 23:30 BST gig would lose its "Today ·" prefix.
function londonTodayYmd(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Europe/London" });
}
function londonYmdOffset(days: number): string {
  const now = new Date();
  now.setUTCDate(now.getUTCDate() + days);
  return now.toLocaleDateString("en-CA", { timeZone: "Europe/London" });
}

export function formatEventTime(iso: string, endIso?: string | null): string {
  const p = londonParts(iso);
  const startTime = formatLondonTime(iso);
  const endTime = endIso ? formatLondonTime(endIso) : null;
  const timeRange = endTime ? `${startTime} – ${endTime}` : startTime;

  const today = londonTodayYmd();
  const tomorrow = londonYmdOffset(1);
  if (p.ymd === today) return `Today · ${timeRange}`;
  if (p.ymd === tomorrow) return `Tomorrow · ${timeRange}`;

  // "This week" = within the next 6 days (Mon-Sun isn't worth chasing
  // here — the UI just needs a "Saturday · 7pm" friendly label).
  const sixDaysOut = londonYmdOffset(6);
  if (p.ymd <= sixDaysOut) {
    return p.weekday + ` · ${timeRange}`;
  }

  // e.g. "Sat 30th May · 7pm – 11pm"
  const ord = ordinal(p.day);
  // Short weekday from the long one we already have.
  const shortWeekday = p.weekday.slice(0, 3);
  // Use Intl to get the short month name in London tz.
  const shortMonth = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London", month: "short",
  }).format(parseISO(iso));
  return `${shortWeekday} ${p.day}${ord} ${shortMonth} · ${timeRange}`;
}

export function formatLongDate(iso: string): string {
  const p = londonParts(iso);
  const ord = ordinal(p.day);
  const longMonth = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London", month: "long",
  }).format(parseISO(iso));
  // e.g. "Saturday 30th May 2026"
  return `${p.weekday} ${p.day}${ord} ${longMonth} ${p.year}`;
}

/**
 * Day-only date label, abbreviated form. Used in festival schedule
 * tabs ("Sat 30th May") and in compact event listings.
 *
 * Input: a date-only YYYY-MM-DD string (e.g. "2026-05-30") OR a
 * full ISO timestamp. We treat date-only strings as local midday to
 * avoid timezone wobble crossing UTC into the wrong day.
 */
export function formatDayShort(day: string): string {
  const d = day.length === 10 ? new Date(day + "T12:00:00") : new Date(day);
  if (Number.isNaN(d.getTime())) return day;
  const ord = ordinal(d.getDate());
  // e.g. "Sat 30th May"
  return format(d, `EEE d'${ord}' MMM`);
}

/**
 * Day-only date label, long form. "Saturday 30th May".
 * Same input rules as formatDayShort.
 */
export function formatDayLong(day: string): string {
  const d = day.length === 10 ? new Date(day + "T12:00:00") : new Date(day);
  if (Number.isNaN(d.getTime())) return day;
  const ord = ordinal(d.getDate());
  // e.g. "Saturday 30th May"
  return format(d, `EEEE d'${ord}' MMMM`);
}

/**
 * Format a festival's start–end date span with ordinal suffixes.
 * Examples:
 *   "Saturday 30th May 2026"                  (single day)
 *   "Sat 30th — Sun 31st May 2026"            (same month)
 *   "Sat 28th Feb — Sun 1st Mar 2026"         (month crossover)
 *
 * Takes date-only strings (YYYY-MM-DD); the venue-localised midday
 * trick avoids timezone wobble on month boundaries.
 */
export function formatFestivalDateRange(startIso: string, endIso: string): string {
  const s = new Date(startIso + "T12:00:00");
  const e = new Date(endIso + "T12:00:00");
  if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime())) {
    return `${startIso} — ${endIso}`;
  }
  if (startIso === endIso) {
    return formatLongDate(s.toISOString());
  }
  const ordS = ordinal(s.getDate());
  const ordE = ordinal(e.getDate());
  const sameMonth = s.getMonth() === e.getMonth() && s.getFullYear() === e.getFullYear();
  if (sameMonth) {
    // "Sat 30th — Sun 31st May 2026"
    return (
      format(s, `EEE d'${ordS}'`) +
      " — " +
      format(e, `EEE d'${ordE}' MMMM yyyy`)
    );
  }
  // "Sat 28th Feb — Sun 1st Mar 2026"
  return (
    format(s, `EEE d'${ordS}' MMM`) +
    " — " +
    format(e, `EEE d'${ordE}' MMM yyyy`)
  );
}

/**
 * Compute the effective end time for an event:
 *  - explicit end_time → use it
 *  - else venue closing time for the event's day-of-week → use that
 *  - else end of the start_time day (23:59:59)
 *
 * Used to auto-hide events on the public site once they're really done.
 */
// Best-effort sports-event detector. Used by effectiveEndTime to give
// football / rugby / UFC etc screenings a sensible 90-minute duration
// when no explicit end_time is set, instead of letting them sit in
// listings all day. False positives (e.g. a "Champions League quiz")
// just expire 90 mins after start instead of end-of-day — acceptable.
function isSportsScreening(title?: string | null): boolean {
  if (!title) return false;
  const t = title.toLowerCase();
  // Sports
  if (/\b(football|rugby|cricket|tennis|golf|boxing|wrestling|darts|snooker|ufc|mma|nfl|nba|nhl|formula\s*1|\bf1\b|grand\s*prix|moto\s*gp|le\s*mans)\b/.test(t)) return true;
  // Tournaments
  if (/\b(premier\s*league|premiership|champions\s*league|europa\s*league|world\s*cup|euros|euro\s*\d{4}|six\s*nations|world\s*champ|fa\s*cup|scottish\s*cup|league\s*cup|carabao\s*cup|la\s*liga|serie\s*a|bundesliga|ligue\s*1|world\s*series|super\s*bowl|ryder\s*cup|the\s*ashes)\b/.test(t)) return true;
  // Generic indicators
  if (/\b(live\s*sport|live\s*match|live\s*game|sport\s*screening|kick[-\s]?off|sky\s*sports|tnt\s*sports|bt\s*sport|sportscreen)\b/.test(t)) return true;
  return false;
}

// Returns the moment after which an event should be considered "over"
// and hidden from public listings.
//
// Rule:
//   1. If event.end_time is set, use that.
//   2. If the title looks like a sports screening (football, UFC etc),
//      assume 90 minutes from start (a football match's playing time).
//      Otherwise a 3pm kickoff would squat in listings until midnight.
//   3. Otherwise fall back to the venue's closing time on the event's
//      start day (handles after-midnight closes, e.g. close at 02:00
//      means 02:00 NEXT day relative to a 21:00 start).
//   4. Otherwise (no venue hours configured), keep the event listed
//      until end of the start day (23:59:59 local).
export function effectiveEndTime(
  event: { start_time: string; end_time?: string | null; title?: string | null },
  venue: {
    opening_hours_json?: Record<string, { open?: string; close?: string; closed?: boolean }> | null;
  } | null | undefined,
): Date {
  if (event.end_time) return new Date(event.end_time);

  const start = new Date(event.start_time);

  // Sports screenings: assume 90 minutes from start. Matches the actual
  // playing time of a football / rugby match — the pub will keep the
  // screen on but fans checking listings won't expect to walk into
  // a live match at 5pm when kickoff was 3pm.
  if (isSportsScreening(event.title)) {
    return new Date(start.getTime() + 90 * 60 * 1000);
  }

  const dayKeys = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;
  const dayKey = dayKeys[start.getDay()];
  const oh = venue?.opening_hours_json?.[dayKey];

  if (oh && !oh.closed && oh.close) {
    const m = /^(\d{1,2}):(\d{2})$/.exec(oh.close);
    if (m) {
      const close = new Date(start);
      close.setHours(parseInt(m[1], 10), parseInt(m[2], 10), 0, 0);
      // If close time is at or before start time, the venue closes after midnight.
      if (close.getTime() <= start.getTime()) {
        close.setDate(close.getDate() + 1);
      }
      return close;
    }
  }

  // Fallback: end of the start day
  const eod = new Date(start);
  eod.setHours(23, 59, 59, 999);
  return eod;
}

export function formatDateRangeLabel(filter: string): string {
  switch (filter) {
    case "today": return "Today / Tonight";
    case "tonight": return "Tonight";
    case "tomorrow": return "Tomorrow";
    case "weekend": return "This weekend";
    case "week": return "This week";
    default: return "Upcoming";
  }
}

// Extract the town name from a UK postal address string. Most of our
// addresses follow "<street>, <town> <postcode>" or "<street>, <town>,
// <region> <postcode>". We find the part containing the postcode and
// pick whatever non-postcode word(s) sit alongside it; fall back to the
// last comma-segment if no postcode is found. Returns null on empty input.
export function extractTownFromAddress(address: string | null | undefined): string | null {
  if (!address) return null;
  const trimmed = address.trim();
  if (!trimmed) return null;

  const postcodeRegex = /[A-Z]{1,2}\d{1,2}[A-Z]?\s*\d[A-Z]{2}/i;
  const parts = trimmed.split(",").map((s) => s.trim()).filter(Boolean);
  if (parts.length === 0) return null;

  // Walk from the end of the address backwards looking for the segment
  // containing the postcode — the town is whatever's in that segment
  // before the postcode (e.g. "Forfar DD8 3AD" → "Forfar").
  for (let i = parts.length - 1; i >= 0; i--) {
    const seg = parts[i];
    if (postcodeRegex.test(seg)) {
      const beforePostcode = seg.replace(postcodeRegex, "").trim();
      if (beforePostcode) return beforePostcode;
      // Postcode was alone in this segment — the town must be the
      // segment immediately before it.
      if (i > 0) return parts[i - 1];
    }
  }

  // No postcode found — best-effort: skip "United Kingdom" / "UK" tail
  // and return the last meaningful segment.
  for (let i = parts.length - 1; i >= 0; i--) {
    const seg = parts[i];
    if (!/^(uk|united kingdom|scotland|england|wales|northern ireland)$/i.test(seg)) {
      return seg;
    }
  }
  return parts[0];
}
