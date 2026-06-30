// Recurring-event helpers. The kids extractor collapses a weekly session to a
// single row with a recurrence_pattern (e.g. "every_friday") instead of one
// row per occurrence — so the DISPLAY has to understand the pattern, otherwise
// a weekly club shows only on its start date and looks like a one-off.

const WEEKDAY: Record<string, number> = {
  every_sunday: 0,
  every_monday: 1,
  every_tuesday: 2,
  every_wednesday: 3,
  every_thursday: 4,
  every_friday: 5,
  every_saturday: 6,
};
const WEEKDAY_NAME = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function norm(pattern?: string | null): string {
  return (pattern || "").toLowerCase().trim();
}

export function isRecurring(pattern?: string | null): boolean {
  const p = norm(pattern);
  if (!p) return false;
  return p === "daily" || p === "every_day" || p === "weekly" || p === "weekdays" || p in WEEKDAY;
}

// Human label for the time/date badge, e.g. "Every Friday", "Weekdays", "Every day".
export function recurrenceLabel(pattern?: string | null, startISO?: string | null): string | null {
  const p = norm(pattern);
  if (p === "daily" || p === "every_day") return "Every day";
  if (p === "weekdays") return "Weekdays";
  if (p in WEEKDAY) return `Every ${WEEKDAY_NAME[WEEKDAY[p]]}`;
  if (p === "weekly") {
    if (startISO) {
      const wd = new Date(startISO).getDay();
      if (!Number.isNaN(wd)) return `Every ${WEEKDAY_NAME[wd]}`;
    }
    return "Weekly";
  }
  return null;
}

// Does a recurring series land on at least one day inside [windowStart, windowEnd]?
// Honours the series start (no occurrences before it) and recurrence_until (no
// occurrences after it). Iterates day-by-day over the (always small) window.
export function recurrenceOccursInWindow(
  pattern: string | null | undefined,
  startISO: string,
  untilISO: string | null | undefined,
  windowStart: Date,
  windowEnd: Date,
): boolean {
  const p = norm(pattern);
  if (!p) return false;
  const start = new Date(startISO);
  if (Number.isNaN(start.getTime())) return false;
  const startDay = new Date(start); startDay.setHours(0, 0, 0, 0);
  const until = untilISO ? new Date(`${untilISO}T23:59:59`) : null;

  const lo = new Date(Math.max(windowStart.getTime(), startDay.getTime())); lo.setHours(0, 0, 0, 0);
  const hiMs = until ? Math.min(windowEnd.getTime(), until.getTime()) : windowEnd.getTime();
  const hi = new Date(hiMs);
  if (lo > hi) return false;

  const startWd = startDay.getDay();
  let guard = 0;
  for (const d = new Date(lo); d <= hi && guard < 400; d.setDate(d.getDate() + 1), guard++) {
    const wd = d.getDay();
    if (p === "daily" || p === "every_day") return true;
    if (p === "weekdays" && wd >= 1 && wd <= 5) return true;
    if (p === "weekly" && wd === startWd) return true;
    if (WEEKDAY[p] !== undefined && wd === WEEKDAY[p]) return true;
  }
  return false;
}
