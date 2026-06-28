"use client";

export type DayHours = { closed?: boolean; open?: string; close?: string };
export type OpeningHours = Partial<Record<DayKey, DayHours>>;
type DayKey = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";

const DAYS: { key: DayKey; label: string }[] = [
  { key: "mon", label: "Mon" },
  { key: "tue", label: "Tue" },
  { key: "wed", label: "Wed" },
  { key: "thu", label: "Thu" },
  { key: "fri", label: "Fri" },
  { key: "sat", label: "Sat" },
  { key: "sun", label: "Sun" },
];

function display12h(s: string | undefined | null): string {
  if (!s) return "—";
  const m = /^(\d{1,2}):(\d{2})$/.exec(s);
  if (!m) return s;
  const h = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  const ampm = h >= 12 ? "pm" : "am";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return min === 0 ? `${h12}${ampm}` : `${h12}:${String(min).padStart(2, "0")}${ampm}`;
}

export function formatHours(value: OpeningHours | null | undefined): string {
  if (!value) return "";
  const lines: string[] = [];
  for (const { key, label } of DAYS) {
    const d = value[key];
    if (!d) continue;
    if (d.closed) lines.push(`${label}: Closed`);
    else if (d.open && d.close) lines.push(`${label}: ${display12h(d.open)} – ${display12h(d.close)}`);
  }
  return lines.join("\n");
}

export default function OpeningHoursEditor({
  value,
  onChange,
}: {
  value: OpeningHours;
  onChange: (next: OpeningHours) => void;
}) {
  function update(day: DayKey, partial: DayHours) {
    onChange({ ...value, [day]: { ...(value[day] ?? {}), ...partial } });
  }

  return (
    <div className="rounded-lg bg-buzz-surface border border-buzz-border divide-y divide-buzz-border/60">
      {DAYS.map(({ key, label }) => {
        const d = value[key] ?? {};
        const closed = !!d.closed;
        return (
          <div key={key} className="flex items-center gap-2 sm:gap-3 px-3 py-2.5">
            <div className="w-12 font-display uppercase tracking-wider text-sm text-buzz-text">{label}</div>
            <div className="flex-1 flex items-center gap-2">
              {closed ? (
                <span className="text-rose-400 italic font-medium text-sm">Closed</span>
              ) : (
                <>
                  <input
                    type="time"
                    value={d.open ?? ""}
                    onChange={(e) => update(key, { open: e.target.value || undefined })}
                    className="bg-buzz-bg border border-buzz-border rounded-md px-2 py-1 text-sm text-buzz-text focus:outline-none focus:border-buzz-accent"
                    aria-label={`${label} open time`}
                  />
                  <span className="text-buzz-mute">–</span>
                  <input
                    type="time"
                    value={d.close ?? ""}
                    onChange={(e) => update(key, { close: e.target.value || undefined })}
                    className="bg-buzz-bg border border-buzz-border rounded-md px-2 py-1 text-sm text-buzz-text focus:outline-none focus:border-buzz-accent"
                    aria-label={`${label} close time`}
                  />
                </>
              )}
            </div>
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input
                type="checkbox"
                checked={closed}
                onChange={(e) => update(key, { closed: e.target.checked })}
                className="accent-rose-500"
              />
              <span className="text-xs text-buzz-mute">Closed</span>
            </label>
          </div>
        );
      })}
    </div>
  );
}
