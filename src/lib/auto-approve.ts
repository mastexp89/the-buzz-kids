// Rules for letting imported events skip the Telegram approval queue, and for
// spotting queued events whose date has already gone.
//
// An imported event goes straight live only when ALL of these hold:
//   - the AI judged it genuinely aimed at kids/families (for_kids),
//   - it landed in at least one Buzz Kids category,
//   - the AI read it confidently,
//   - it isn't age-gated above primary age.
// Anything else still comes to the admins group for a human look.

export const AUTO_APPROVE_MIN_CONFIDENCE = 0.7;
export const AUTO_APPROVE_MAX_AGE_MIN = 12;

export function shouldAutoApprove(opts: {
  forKids: boolean;
  genreCount: number;
  confidence: number | null | undefined;
  ageMin: number | null | undefined;
}): boolean {
  return (
    opts.forKids &&
    opts.genreCount > 0 &&
    (opts.confidence ?? 0) >= AUTO_APPROVE_MIN_CONFIDENCE &&
    (opts.ageMin == null || opts.ageMin <= AUTO_APPROVE_MAX_AGE_MIN)
  );
}

/** True when an event (one-off, multi-day run or recurring series) is finished. */
export function eventIsOver(
  e: {
    start_time: string;
    end_time?: string | null;
    end_date?: string | null;
    recurrence_pattern?: string | null;
    recurrence_until?: string | null;
  },
  now: Date = new Date(),
): boolean {
  const todayLocal = now.toLocaleDateString("en-CA", { timeZone: "Europe/London" });
  const startOfToday = new Date(`${todayLocal}T00:00:00Z`);
  if (e.recurrence_pattern) {
    return !!e.recurrence_until && e.recurrence_until < todayLocal;
  }
  if (e.end_date) return e.end_date < todayLocal;
  const end = e.end_time ? new Date(e.end_time) : new Date(e.start_time);
  return !Number.isNaN(end.getTime()) && end < startOfToday;
}
