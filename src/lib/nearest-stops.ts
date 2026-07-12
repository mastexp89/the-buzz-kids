// Compute & store a venue's nearest bus stop + rail station from the
// transport_stops (NaPTAN) reference table. Used incrementally by the
// enrichment cron once a venue has coordinates. The public pages read the
// stored nearest_* columns, so this never runs at display time.

import type { createServiceClient } from "@/lib/supabase/service";

function haversineM(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371000;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

// Bus stops are dense (small search box); rail stations sparse (wide box).
const BUS_BOX = 0.06;   // ~6.6 km
const RAIL_BOX = 0.45;  // ~50 km lat
const RAIL_CAP_M = 60000;

export async function fillNearestStops(
  sb: ReturnType<typeof createServiceClient>,
  venueId: string,
): Promise<boolean> {
  const { data: v } = await sb
    .from("venues")
    .select("latitude, longitude, nearest_bus_stop, nearest_rail_station")
    .eq("id", venueId)
    .maybeSingle();
  if (!v || v.latitude == null || v.longitude == null) return false;
  if (v.nearest_bus_stop && v.nearest_rail_station) return false; // already done

  const lat = v.latitude as number;
  const lng = v.longitude as number;
  const lngScale = Math.max(0.2, Math.cos((lat * Math.PI) / 180)); // widen lng box further north

  const [busRes, railRes] = await Promise.all([
    sb.from("transport_stops").select("name, latitude, longitude").eq("kind", "bus")
      .gte("latitude", lat - BUS_BOX).lte("latitude", lat + BUS_BOX)
      .gte("longitude", lng - BUS_BOX / lngScale).lte("longitude", lng + BUS_BOX / lngScale),
    sb.from("transport_stops").select("name, latitude, longitude").eq("kind", "rail")
      .gte("latitude", lat - RAIL_BOX).lte("latitude", lat + RAIL_BOX)
      .gte("longitude", lng - RAIL_BOX / lngScale).lte("longitude", lng + RAIL_BOX / lngScale),
  ]);

  const nearest = (rows: any[] | null) => {
    let best: { name: string; m: number } | null = null;
    for (const s of rows ?? []) {
      const m = haversineM(lat, lng, s.latitude, s.longitude);
      if (!best || m < best.m) best = { name: s.name, m };
    }
    return best;
  };

  const bus = nearest(busRes.data);
  const rail = nearest(railRes.data);

  const u: Record<string, unknown> = {};
  if (bus) { u.nearest_bus_stop = bus.name; u.nearest_bus_stop_m = Math.round(bus.m); }
  if (rail && rail.m <= RAIL_CAP_M) { u.nearest_rail_station = rail.name; u.nearest_rail_station_m = Math.round(rail.m); }
  if (Object.keys(u).length === 0) return false;
  await sb.from("venues").update(u).eq("id", venueId);
  return true;
}
