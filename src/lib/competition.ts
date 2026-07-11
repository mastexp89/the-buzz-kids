// Circus Extreme competition config. One-off; edit these constants to change
// the copy / dates, or when you run the next competition.
//
// Dates: entries close at `closesAt`; winner drawn per `winnerText`.
export const CIRCUS = {
  // ⚠ Master switch — while false, /win-circus shows "not open yet" and nobody
  // can be entered. Flip to true when you're ready to announce.
  open: true,
  slug: "circus-extreme",
  title: "Circus Extreme",
  prizeLine: "A family ticket for up to 4 — any mix (4 adults, or 2 adults + 2 kids, etc). Valid at any location.",
  closesAt: "2026-07-24T17:00:00+01:00",   // entries close 5pm Fri 24 July (BST)
  closesText: "5pm on Friday 24 July",     // for display
  winnerText: "Friday 24 July at 6pm",     // shown to entrants
  website: "https://www.circusextreme.co.uk/",
  logo: "/circus-extreme-logo.png",
  locations: [
    { city: "Aberdeen", place: "Beach Links (AB24 5EN)", dates: "17 July – 3 August 2026" },
    { city: "Glasgow", place: "Silverburn Shopping Centre (G53 6AG, green car park)", dates: "7 – 23 August 2026" },
  ],
};

export function circusClosed(): boolean {
  return Date.now() >= new Date(CIRCUS.closesAt).getTime();
}
