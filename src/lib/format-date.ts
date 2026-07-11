// User-facing date formatting. Dylan's preference: always show the day with an
// ordinal suffix (17th, 3rd, 23rd), never a bare number. Use these helpers for
// any date shown to a user so it reads naturally.

export function ordinal(day: number): string {
  const j = day % 10;
  const k = day % 100;
  if (k >= 11 && k <= 13) return `${day}th`;
  if (j === 1) return `${day}st`;
  if (j === 2) return `${day}nd`;
  if (j === 3) return `${day}rd`;
  return `${day}th`;
}

// e.g. "17th Jul", "3rd August 2026". Pass opts to control month/year style.
export function formatDateOrdinal(
  date: Date | string,
  opts: { month?: "short" | "long"; year?: boolean; weekday?: "short" | "long" } = {},
): string {
  const d = typeof date === "string" ? new Date(date) : date;
  if (isNaN(d.getTime())) return "";
  const { month = "short", year = false, weekday } = opts;
  const parts: string[] = [];
  if (weekday) parts.push(d.toLocaleDateString("en-GB", { weekday, timeZone: "Europe/London" }));
  const dayNum = Number(d.toLocaleDateString("en-GB", { day: "numeric", timeZone: "Europe/London" }));
  const monthName = d.toLocaleDateString("en-GB", { month, timeZone: "Europe/London" });
  let dm = `${ordinal(dayNum)} ${monthName}`;
  if (year) dm += ` ${d.toLocaleDateString("en-GB", { year: "numeric", timeZone: "Europe/London" })}`;
  parts.push(dm);
  return parts.join(", ");
}
