"use client";

// Map view for /dashboard/today. Renders a numbered marker for each
// event in chronological order so the user can see their route through
// the day at a glance.

import { MapContainer, TileLayer, Marker, Popup, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import Link from "next/link";
import { useEffect, useMemo } from "react";

type PlannerVenue = {
  id: string;
  name: string;
  slug: string;
  latitude: number | null;
  longitude: number | null;
  citySlug: string | null;
};

type PlannerEvent = {
  id: string;
  title: string;
  start_time: string;
  venue: PlannerVenue;
};

function numberedIcon(n: number): L.DivIcon {
  // Yellow pin with the sequence number — visually anchors "gig 1, 2, 3"
  // against the list view next to it. Outline gives contrast over both
  // light and dark map tiles.
  return L.divIcon({
    className: "",
    iconSize: [32, 32],
    iconAnchor: [16, 32],
    popupAnchor: [0, -28],
    html: `
      <div style="
        width:32px;height:32px;
        background:#fdb913;
        border:2px solid #111;
        border-radius:50% 50% 50% 0;
        transform:rotate(-45deg);
        display:flex;align-items:center;justify-content:center;
        box-shadow:0 2px 6px rgba(0,0,0,0.5);
      ">
        <span style="
          color:#111;font-weight:800;font-size:14px;
          transform:rotate(45deg);
        ">${n}</span>
      </div>
    `,
  });
}

function FitBounds({ events }: { events: PlannerEvent[] }) {
  const map = useMap();
  useEffect(() => {
    const points = events
      .filter(
        (e) =>
          typeof e.venue.latitude === "number" &&
          typeof e.venue.longitude === "number",
      )
      .map(
        (e) => [e.venue.latitude!, e.venue.longitude!] as [number, number],
      );
    if (points.length === 0) return;
    if (points.length === 1) map.setView(points[0], 15);
    else map.fitBounds(points, { padding: [50, 50] });
  }, [events, map]);
  return null;
}

export default function DayPlannerMap({ events }: { events: PlannerEvent[] }) {
  // Only events with coords go on the map; the list shows everything.
  const mappable = useMemo(
    () =>
      events.filter(
        (e) =>
          typeof e.venue.latitude === "number" &&
          typeof e.venue.longitude === "number",
      ),
    [events],
  );

  if (mappable.length === 0) {
    return (
      <div className="card p-6 text-center text-sm text-buzz-mute">
        None of these venues have map coordinates yet — admin can add them
        from the venue edit page.
      </div>
    );
  }

  const center: [number, number] = [
    mappable[0].venue.latitude!,
    mappable[0].venue.longitude!,
  ];

  return (
    <div className="rounded-2xl overflow-hidden border border-buzz-border h-[420px]">
      <MapContainer
        center={center}
        zoom={14}
        scrollWheelZoom={false}
        style={{ width: "100%", height: "100%" }}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <FitBounds events={mappable} />
        {mappable.map((e, idx) => {
          const seq = idx + 1;
          return (
            <Marker
              key={e.id}
              position={[e.venue.latitude!, e.venue.longitude!]}
              icon={numberedIcon(seq)}
            >
              <Popup>
                <div style={{ minWidth: 180 }}>
                  <div style={{ fontWeight: 700, marginBottom: 4 }}>
                    {seq}. {e.title}
                  </div>
                  <div style={{ fontSize: 12, color: "#555" }}>
                    {new Date(e.start_time).toLocaleTimeString("en-GB", {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                    {" · "}
                    {e.venue.name}
                  </div>
                  {e.venue.citySlug && (
                    <Link
                      href={`/${e.venue.citySlug}/events/${e.id}`}
                      style={{
                        display: "inline-block",
                        marginTop: 6,
                        color: "#cc8400",
                        fontWeight: 600,
                        textDecoration: "underline",
                      }}
                    >
                      View details →
                    </Link>
                  )}
                </div>
              </Popup>
            </Marker>
          );
        })}
      </MapContainer>
    </div>
  );
}
