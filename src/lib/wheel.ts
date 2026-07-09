// Shared, pure logic for the lucky wheel. Imported by BOTH the /win page
// (to draw the wheel) and the spin server action (to pick the winning slice)
// so the visual slice order and the server's index always match.

export type WheelPrize = {
  id: string;
  label: string;
  kind: "entry" | "real";
  slots: number;
  color: string;
  sort: number;
  active: boolean;
};

export type WheelSlice = {
  prizeId: string;
  label: string;
  kind: "entry" | "real";
  color: string;
};

// Expand each prize into `slots` slices, spread round-robin so a prize with
// several slots isn't clumped on one side of the wheel. Deterministic: same
// prizes in, same slice order out — that's what keeps page and server aligned.
export function expandSlices(prizes: WheelPrize[]): WheelSlice[] {
  const active = prizes
    .filter((p) => p.active && p.slots > 0)
    .sort((a, b) => a.sort - b.sort);

  const remaining = active.map((p) => p.slots);
  const slices: WheelSlice[] = [];
  let left = remaining.reduce((a, b) => a + b, 0);

  while (left > 0) {
    for (let i = 0; i < active.length; i++) {
      if (remaining[i] > 0) {
        const p = active[i];
        slices.push({ prizeId: p.id, label: p.label, kind: p.kind, color: p.color });
        remaining[i]--;
        left--;
      }
    }
  }
  return slices;
}

// The conic-gradient background for a wheel of these slices.
export function conicGradient(slices: WheelSlice[]): string {
  const step = 360 / slices.length;
  const stops = slices
    .map((s, i) => `${s.color} ${i * step}deg ${(i + 1) * step}deg`)
    .join(",");
  return `conic-gradient(${stops})`;
}
