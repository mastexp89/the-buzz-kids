// Circus Extreme competition config. One-off; edit these constants to change
// the copy / dates, or when you run the next competition.
//
// ⚠ CONFIRM `closesOn` + `winnerText` before you announce — placeholders below.
export const CIRCUS = {
  // ⚠ Master switch — while false, /win-circus shows "not open yet" and nobody
  // can be entered. Flip to true when you're ready to announce.
  open: false,
  slug: "circus-extreme",
  title: "Circus Extreme",
  prizeLine: "A family ticket for up to 4 — any mix (4 adults, or 2 adults + 2 kids, etc). Valid at any location.",
  closesOn: "2026-07-24",                 // last day to enter (London date)
  winnerText: "Saturday 25 July at 3pm",  // shown to entrants
  locations: [
    { city: "Aberdeen", place: "Beach Links (AB24 5EN)", dates: "17 July – 3 August 2026" },
    { city: "Glasgow", place: "Silverburn Shopping Centre (G53 6AG, green car park)", dates: "7 – 23 August 2026" },
  ],
};

export function circusClosed(): boolean {
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Europe/London" });
  return today > CIRCUS.closesOn;
}
