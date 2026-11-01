// Rules for letting imported events skip the Telegram approval queue, and for
// spotting queued events whose date has already gone.
//
// An imported event goes straight live when the AI read it confidently AND it
// landed in at least one Buzz Kids category (a kids genre). Anything vague or
// uncategorised still comes to the admins group for a human look.

export const AUTO_APPROVE_MIN_CONFIDENCE = 0.7;

export function shouldAutoApprove(opts: { genreCount: number; confidence: number | null | undefined }): boolean {
  return opts.genreCount > 0 && (opts.confidence ?? 0) >= AUTO_APPROVE_MIN_CONFIDENCE;
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
