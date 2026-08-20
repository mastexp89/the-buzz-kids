// Branded daily graphic for the Facebook roundup posts.
//
// Rendered server-side with next/og's ImageResponse from the EXACT picks used
// in the post caption, then uploaded to the media bucket so Facebook can fetch
// it by URL. Free — no image model, no paid API.
//
// Square (1080×1080): most vertical space in a mobile feed.
//
// Kids palette is light & bright (the Guide's is black/gold). satori quirk:
// the CSS `inset` shorthand is ignored, so every absolute layer sets explicit
// top/left/width/height, and every element with children declares display:flex.

import { ImageResponse } from "next/og";
import type { SupabaseClient } from "@supabase/supabase-js";

const BLUE = "#1FA9E0";     // brand accent
const PINK = "#EC1E8C";
const INK = "#16202A";
const MUTE = "#647682";
const GOOD = "#2E9E33";     // "free"
const YELLOW = "#FFD23F";
const BUCKET = "media";
const FOLDER = "fb-posts";

export type PostLine = {
  time: string;      // "10am" or "All day"
  title: string;
  venue: string;
  icon: string;
  promoted?: boolean;
  free?: boolean;
  ages?: string | null;   // "2–8 yrs"
  area?: string | null;   // "Dundee" — the roundup spans all of Scotland
};

// Playful honeycomb — keeps the "Buzz" bee cue, but drawn in soft brand blue
// on a light background instead of the Guide's gold-on-black. One SVG data URI
// for the whole sheet (satori tiles background images unreliably).
function honeycombDataUri(size = 1080, r = 58): string {
  const w = Math.sqrt(3) * r;
  const vStep = 1.5 * r;
  const hex = (cx: number, cy: number) =>
    Array.from({ length: 6 }, (_, i) => {
      const a = (Math.PI / 180) * (60 * i - 30);
      return `${(cx + r * Math.cos(a)).toFixed(1)},${(cy + r * Math.sin(a)).toFixed(1)}`;
    }).join(" ");

  const shapes: string[] = [];
  for (let row = -1; row * vStep < size + vStep; row++) {
    const cy = row * vStep;
    const offset = row % 2 === 0 ? 0 : w / 2;
    for (let col = -1; col * w + offset < size + w; col++) {
      shapes.push(`<polygon points="${hex(col * w + offset, cy)}" />`);
    }
  }
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">` +
    `<g fill="none" stroke="${BLUE}" stroke-width="3" stroke-opacity="0.9">${shapes.join("")}</g>` +
    `</svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}

export async function renderDailyPostPng(opts: {
  cityName: string;
  dateLabel: string;    // "Thursday 20th August"
  lines: PostLine[];
  totalToday?: number;
  venueCount?: number;
  logoUrl: string;
}): Promise<Buffer> {
  const { cityName, dateLabel, lines, totalToday = 0, venueCount = 0, logoUrl } = opts;
  const more = Math.max(0, totalToday - lines.length);
  const showMore = more >= 3;              // "+1 more" reads as thin
  const showScale = totalToday >= 8 && venueCount >= 3;
  const citySize = cityName.length > 9 ? 88 : 112;
  // The national roundup runs to ~8 lines; tighten type and spacing past 6 so
  // everything still fits the 1080 square without clipping the footer.
  const dense = lines.length > 6;
  const rowGap = dense ? 8 : 16;
  const titleSize = dense ? 27 : 31;
  const metaSize = dense ? 21 : 24;
  const timeSize = dense ? 25 : 29;
  const timeWidth = dense ? 118 : 138;
  const listTop = dense ? 20 : 40;
  // 8 rows overflowed the square and clipped the footer, so the whole frame
  // tightens (not just the rows) once the list is long.
  const pad = dense ? 52 : 68;
  const logoSize = dense ? 132 : 158;
  const footerTop = dense ? 16 : 22;

  const el = (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        position: "relative",
        padding: pad,
        background: "linear-gradient(160deg, #FFFFFF 0%, #F2F9FE 55%, #E8F2FA 100%)",
        color: INK,
        fontFamily: "system-ui, sans-serif",
      }}
    >
      {/* honeycomb, kept faint so listings stay readable */}
      <div
        style={{
          position: "absolute", top: 0, left: 0, width: 1080, height: 1080,
          display: "flex", opacity: 0.13,
          backgroundImage: `url(${honeycombDataUri()})`,
          backgroundSize: "1080px 1080px",
        }}
      />
      {/* white veil so the lower half (the text) sits on near-plain paper */}
      <div
        style={{
          position: "absolute", top: 0, left: 0, width: 1080, height: 1080, display: "flex",
          background:
            "linear-gradient(170deg, rgba(255,255,255,0.10) 0%, rgba(255,255,255,0.72) 42%, rgba(255,255,255,0.95) 76%)",
        }}
      />
      {/* sunny corner wash */}
      <div
        style={{
          position: "absolute", top: -300, right: -220, width: 720, height: 720,
          borderRadius: 720, display: "flex",
          background: "linear-gradient(135deg, rgba(255,210,63,0.55), rgba(255,210,63,0))",
        }}
      />

      {/* brand + headline */}
      <div style={{ display: "flex", alignItems: "flex-start", gap: 26 }}>
        <img src={logoUrl} width={logoSize} height={logoSize} style={{ objectFit: "contain" }} />
        <div style={{ display: "flex", flexDirection: "column", flex: 1, marginTop: 8 }}>
          <div
            style={{
              display: "flex", fontSize: 26, letterSpacing: 6, textTransform: "uppercase",
              color: PINK, fontWeight: 700,
            }}
          >
            What&apos;s on for the kids
          </div>
          <div
            style={{
              display: "flex", fontSize: citySize, fontWeight: 900, lineHeight: 1,
              textTransform: "uppercase", letterSpacing: -2, marginTop: 6, color: INK,
            }}
          >
            {cityName}
          </div>
          <div style={{ display: "flex", fontSize: 25, color: MUTE, marginTop: 10 }}>{dateLabel}</div>
        </div>
      </div>

      {/* scale banner — makes clear the five below are a sample */}
      {showScale && (
        <div
          style={{
            display: "flex", alignItems: "center", gap: 12, marginTop: dense ? 16 : 24,
            background: "rgba(31,169,224,0.10)", border: `1px solid rgba(31,169,224,0.40)`,
            borderRadius: 16, padding: dense ? "9px 18px" : "13px 20px", alignSelf: "flex-start",
          }}
        >
          <div style={{ display: "flex", fontSize: 29, fontWeight: 900, color: BLUE }}>
            {totalToday} things on
          </div>
          <div style={{ display: "flex", fontSize: 24, color: MUTE }}>
            across {venueCount} places today — here are {lines.length}
          </div>
        </div>
      )}

      {/* the picks */}
      <div style={{ display: "flex", flexDirection: "column", gap: rowGap, marginTop: listTop }}>
        {lines.map((l, i) => (
          <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 14 }}>
            <div style={{ display: "flex", minWidth: timeWidth, fontSize: timeSize, fontWeight: 800, color: BLUE }}>
              {l.promoted ? "⭐ " : ""}{l.time}
            </div>
            <div style={{ display: "flex", flexDirection: "column", flex: 1 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{ display: "flex", fontSize: titleSize, fontWeight: 700, lineHeight: 1.15, color: INK }}>
                  {l.title.length > 34 ? l.title.slice(0, 32) + "…" : l.title}
                </div>
                {l.free && (
                  <div
                    style={{
                      display: "flex", fontSize: 19, fontWeight: 800, color: "#FFFFFF",
                      background: GOOD, borderRadius: 999, padding: "3px 12px",
                    }}
                  >
                    FREE
                  </div>
                )}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 3 }}>
                {l.area && (
                  <div
                    style={{
                      display: "flex", fontSize: 20, fontWeight: 800, color: BLUE,
                      background: "rgba(31,169,224,0.12)", borderRadius: 999, padding: "2px 12px",
                    }}
                  >
                    📍 {l.area}
                  </div>
                )}
                <div style={{ display: "flex", fontSize: metaSize, color: MUTE }}>
                  {l.venue.length > 28 ? l.venue.slice(0, 26) + "…" : l.venue}
                </div>
                {l.ages && (
                  <div
                    style={{
                      display: "flex", fontSize: 19, fontWeight: 700, color: INK,
                      background: YELLOW, borderRadius: 999, padding: "2px 11px",
                    }}
                  >
                    {l.ages}
                  </div>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* footer */}
      <div
        style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          marginTop: "auto", borderTop: "1px solid rgba(22,32,42,0.14)", paddingTop: footerTop,
        }}
      >
        <div style={{ display: "flex", flexDirection: "column" }}>
          {showMore && (
            <div style={{ display: "flex", fontSize: 33, fontWeight: 900, color: PINK }}>
              + {more} more on today
            </div>
          )}
          <div style={{ display: "flex", fontSize: 25, color: MUTE, marginTop: showMore ? 4 : 0 }}>
            {showMore ? "See them all at" : "Full listings at"} thebuzzkids.co.uk
          </div>
        </div>
      </div>
    </div>
  );

  const res = new ImageResponse(el, { width: 1080, height: 1080 });
  return Buffer.from(await res.arrayBuffer());
}

/**
 * Render + store today's graphic, returning a public URL Facebook can fetch.
 * Keyed by city + date so re-running a day overwrites rather than piling up.
 */
export async function buildAndStorePostImage(
  sb: SupabaseClient,
  opts: {
    citySlug: string; cityName: string; dateLabel: string; ymd: string;
    lines: PostLine[]; totalToday?: number; venueCount?: number; logoUrl: string;
  },
): Promise<string | null> {
  try {
    const png = await renderDailyPostPng(opts);
    const path = `${FOLDER}/${opts.citySlug}-${opts.ymd}.png`;
    const { error } = await sb.storage
      .from(BUCKET)
      .upload(path, png, { upsert: true, contentType: "image/png", cacheControl: "86400" });
    if (error) return null;
    const { data } = sb.storage.from(BUCKET).getPublicUrl(path);
    return `${data.publicUrl}?v=${Date.now()}`;
  } catch {
    return null;
  }
}
