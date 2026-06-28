"use client";

import { MapContainer, TileLayer, Marker, Popup, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import Link from "next/link";
import { useEffect } from "react";

// Default Leaflet marker icons reference assets via relative URLs that break
// in Next.js. Provide them explicitly from a CDN.
const defaultIcon = L.icon({
  iconUrl: "https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/images/marker-icon.png",
  iconRetinaUrl: "https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  shadowUrl: "https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/images/marker-shadow.png",
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
});
L.Marker.prototype.options.icon = defaultIcon;

type Venue = {
  id: string;
  name: string;
  slug: string;
  address: string | null;
  postcode: string | null;
  latitude: number | null;
  longitude: number | null;
  upcoming_count?: number;
};

// Recenter the map when venues change
function FitBounds({ venues }: { venues: Venue[] }) {
  const map = useMap();
  useEffect(() => {
    const points = venues
      .filter((v) => typeof v.latitude === "number" && typeof v.longitude === "number")
      .map((v) => [v.latitude!, v.longitude!] as [number, number]);
    if (points.length === 0) return;
    if (points.length === 1) {
      map.setView(points[0], 14);
    } else {
      map.fitBounds(points, { padding: [40, 40] });
    }
  }, [venues, map]);
  return null;
}

export default function CityMap({
  venues,
  citySlug,
  cityCenter = [56.4620, -2.9707], // Dundee
}: {
  venues: Venue[];
  citySlug: string;
  cityCenter?: [number, number];
}) {
  const valid = venues.filter(
    (v) => typeof v.latitude === "number" && typeof v.longitude === "number",
  );

  return (
    <div className="rounded-2xl overflow-hidden border border-buzz-border" style={{ height: "70vh", minHeight: 480 }}>
      <MapContainer
        center={cityCenter}
        zoom={13}
        scrollWheelZoom
        style={{ height: "100%", width: "100%" }}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <FitBounds venues={valid} />
        {valid.map((v) => (
          <Marker key={v.id} position={[v.latitude!, v.longitude!]}>
            <Popup>
              <div style={{ minWidth: 180 }}>
                <strong style={{ fontSize: 14 }}>{v.name}</strong>
                {v.address && <div style={{ fontSize: 12, color: "#666", marginTop: 2 }}>{v.address}</div>}
                {typeof v.upcoming_count === "number" && v.upcoming_count > 0 && (
                  <div style={{ fontSize: 12, color: "#fdb913", marginTop: 4, fontWeight: 600 }}>
                    {v.upcoming_count} upcoming {v.upcoming_count === 1 ? "gig" : "gigs"}
                  </div>
                )}
                <Link
                  href={`/${citySlug}/venues/${v.slug}`}
                  style={{
                    display: "inline-block",
                    marginTop: 8,
                    padding: "4px 12px",
                    background: "#fdb913",
                    color: "#000",
                    fontWeight: 700,
                    borderRadius: 6,
                    textDecoration: "none",
                    fontSize: 12,
                  }}
                >
                  View venue →
                </Link>
              </div>
            </Popup>
          </Marker>
        ))}
      </MapContainer>
    </div>
  );
}
