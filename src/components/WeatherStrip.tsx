"use client";

// Compact weather forecast for the What's On view — helps parents judge
// "indoor or outdoor day?" for the dates they're browsing. Data comes from
// Open-Meteo (free, no key). One row per selected area (capped at 3 so
// multi-location stays readable); hidden entirely when no area is picked
// (all-Scotland weather isn't meaningful) or dates are beyond the forecast.

import { useEffect, useState } from "react";

export type WeatherArea = { label: string; lat: number; lon: number };

type DayForecast = { date: string; code: number; tmax: number; rain: number };

// WMO weather codes → emoji.
function icon(code: number): string {
  if (code === 0) return "☀️";
  if (code <= 2) return "🌤️";
  if (code === 3) return "☁️";
  if (code <= 48) return "🌫️";
  if (code <= 57) return "🌦️";
  if (code <= 67) return "🌧️";
  if (code <= 77) return "🌨️";
  if (code <= 82) return "🌧️";
  if (code <= 86) return "🌨️";
  return "⛈️";
}

const dayLabel = (iso: string) =>
  new Date(iso + "T12:00:00").toLocaleDateString("en-GB", { weekday: "short" });

export default function WeatherStrip({
  areas,
  startDate, // YYYY-MM-DD
  endDate,   // YYYY-MM-DD (inclusive)
}: {
  areas: WeatherArea[];
  startDate: string;
  endDate: string;
}) {
  const [data, setData] = useState<Record<string, DayForecast[]>>({});

  const shown = areas.slice(0, 3);
  const key = shown.map((a) => a.label).join("|") + startDate + endDate;

  useEffect(() => {
    let cancelled = false;
    if (shown.length === 0) { setData({}); return; }
    // Open-Meteo forecasts ~16 days out — skip anything beyond that.
    const max = new Date(); max.setDate(max.getDate() + 15);
    if (new Date(startDate + "T00:00:00") > max) { setData({}); return; }
    const end = new Date(endDate + "T00:00:00") > max ? max.toISOString().slice(0, 10) : endDate;

    (async () => {
      const out: Record<string, DayForecast[]> = {};
      await Promise.all(shown.map(async (a) => {
        try {
          const url = `https://api.open-meteo.com/v1/forecast?latitude=${a.lat.toFixed(3)}&longitude=${a.lon.toFixed(3)}&daily=weather_code,temperature_2m_max,precipitation_probability_max&timezone=Europe%2FLondon&start_date=${startDate}&end_date=${end}`;
          const res = await fetch(url);
          if (!res.ok) return;
          const j = await res.json();
          const days: DayForecast[] = (j?.daily?.time ?? []).map((t: string, i: number) => ({
            date: t,
            code: j.daily.weather_code?.[i] ?? 3,
            tmax: Math.round(j.daily.temperature_2m_max?.[i] ?? 0),
            rain: Math.round(j.daily.precipitation_probability_max?.[i] ?? 0),
          }));
          if (days.length) out[a.label] = days.slice(0, 7);
        } catch { /* weather is decoration — never break the page */ }
      }));
      if (!cancelled) setData(out);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const rows = shown.filter((a) => data[a.label]?.length);
  if (rows.length === 0) return null;

  return (
    <div className="mb-6 flex flex-col gap-1.5">
      {rows.map((a) => (
        <div key={a.label} className="flex items-center gap-2 overflow-x-auto text-sm">
          <span className="shrink-0 text-xs font-semibold uppercase tracking-wider text-buzz-mute w-24 truncate" title={a.label}>
            {a.label}
          </span>
          <div className="flex items-center gap-1.5">
            {data[a.label].map((d) => (
              <span
                key={d.date}
                className="shrink-0 inline-flex items-center gap-1 rounded-full bg-buzz-card border border-buzz-border px-2.5 py-1 text-xs whitespace-nowrap"
                title={`${dayLabel(d.date)}: ${d.tmax}°C, ${d.rain}% chance of rain`}
              >
                <span className="text-buzz-mute">{dayLabel(d.date)}</span>
                <span aria-hidden>{icon(d.code)}</span>
                <span className="font-semibold">{d.tmax}°</span>
                {d.rain >= 40 && <span className="text-buzz-mute">💧{d.rain}%</span>}
              </span>
            ))}
          </div>
        </div>
      ))}
      <p className="text-[10px] text-buzz-mute">Local forecast · Open-Meteo</p>
    </div>
  );
}
