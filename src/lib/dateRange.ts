import {
  endOfDay, endOfWeek, startOfDay, startOfTomorrow, addDays, isSaturday, isSunday, isFriday,
} from "date-fns";

export type DateFilter = "today" | "tonight" | "tomorrow" | "weekend" | "week" | "all" | string; // string = ISO date

export function dateRangeFor(filter: DateFilter): { from: Date; to: Date } {
  const now = new Date();
  if (filter === "today") {
    return { from: startOfDay(now), to: endOfDay(now) };
  }
  if (filter === "tonight") {
    const sixPm = new Date(now);
    sixPm.setHours(18, 0, 0, 0);
    const from = now.getTime() > sixPm.getTime() ? now : sixPm;
    return { from, to: endOfDay(now) };
  }
  if (filter === "tomorrow") {
    const t = startOfTomorrow();
    return { from: t, to: endOfDay(t) };
  }
  if (filter === "weekend") {
    // Friday evening through Sunday end
    let from = startOfDay(now);
    if (!(isFriday(now) || isSaturday(now) || isSunday(now))) {
      // Move to next Friday
      const day = now.getDay(); // 0 sun … 6 sat
      const daysUntilFri = (5 - day + 7) % 7;
      from = startOfDay(addDays(now, daysUntilFri));
    } else {
      from = now;
    }
    // Find next Sunday from `from`
    const day = from.getDay();
    const daysUntilSun = (7 - day) % 7;
    const to = endOfDay(addDays(from, daysUntilSun));
    return { from, to };
  }
  if (filter === "week") {
    return { from: now, to: endOfWeek(now, { weekStartsOn: 1 }) };
  }
  if (filter === "all") {
    return { from: now, to: addDays(now, 365) };
  }
  // Custom date string YYYY-MM-DD
  const d = new Date(filter + "T00:00:00");
  if (Number.isNaN(d.getTime())) {
    return { from: now, to: addDays(now, 365) };
  }
  return { from: startOfDay(d), to: endOfDay(d) };
}
