import { ImageResponse } from "next/og";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const alt = "The Buzz Guide — gig poster";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function Image({ params }: { params: Promise<{ city: string; id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: event } = await supabase
    .from("events")
    .select("title, start_time, cover_charge, image_url, venue:venues(name, city:cities(name))")
    .eq("id", id)
    .single();

  const title = event?.title ?? "What's on · The Buzz Guide";
  const venueName = (event?.venue as any)?.name ?? "";
  const cityName = (event?.venue as any)?.city?.name ?? "";
  const cover = event?.cover_charge ?? "";

  const startStr = event?.start_time
    ? new Date(event.start_time).toLocaleDateString("en-GB", {
        weekday: "long",
        day: "numeric",
        month: "long",
        hour: "numeric",
        minute: "2-digit",
      })
    : "";

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: 80,
          background:
            "linear-gradient(135deg, #000 0%, #1a1a1a 60%, #2a1a00 100%)",
          color: "#f5f5f0",
          fontFamily: "system-ui, sans-serif",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div
            style={{
              fontSize: 22,
              letterSpacing: 8,
              color: "#fdb913",
              textTransform: "uppercase",
              fontWeight: 600,
            }}
          >
            Live Music · {cityName}
          </div>
          <div
            style={{
              fontSize: 28,
              color: "#fdb913",
              opacity: 0.9,
              marginTop: 4,
            }}
          >
            {startStr}
          </div>
        </div>

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            fontSize: 100,
            fontWeight: 900,
            lineHeight: 1,
            textTransform: "uppercase",
            letterSpacing: -2,
            maxWidth: "100%",
          }}
        >
          {title.length > 50 ? title.slice(0, 47) + "…" : title}
        </div>

        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-end",
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", fontSize: 32 }}>
            <span style={{ opacity: 0.6, fontSize: 20, textTransform: "uppercase", letterSpacing: 3 }}>at</span>
            <span style={{ fontWeight: 700 }}>{venueName}</span>
            {cover && (
              <span style={{ marginTop: 6, color: "#fdb913", fontSize: 24 }}>{cover}</span>
            )}
          </div>
          <div
            style={{
              fontFamily: "cursive",
              fontSize: 64,
              color: "#fdb913",
              fontStyle: "italic",
            }}
          >
            The Buzz Guide
          </div>
        </div>
      </div>
    ),
    { ...size }
  );
}
