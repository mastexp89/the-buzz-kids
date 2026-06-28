// UK postcode → lat/long via the free postcodes.io API.
// No auth, no rate limits at our scale.
// Returns null if postcode invalid or lookup fails.

export type LatLng = { lat: number; lng: number };

export async function geocodePostcode(postcode: string | null | undefined): Promise<LatLng | null> {
  if (!postcode) return null;
  // postcodes.io accepts the postcode with no spaces, e.g. "DD11UQ" not "DD1 1UQ"
  const cleaned = postcode.trim().replace(/\s+/g, "").toUpperCase();
  if (!cleaned) return null;

  try {
    const res = await fetch(`https://api.postcodes.io/postcodes/${encodeURIComponent(cleaned)}`, {
      next: { revalidate: 60 * 60 * 24 * 7 }, // cache 1 week — postcodes don't move
    });
    if (!res.ok) return null;
    const json = await res.json();
    const lat = json?.result?.latitude;
    const lng = json?.result?.longitude;
    if (typeof lat === "number" && typeof lng === "number") {
      return { lat, lng };
    }
    return null;
  } catch {
    return null;
  }
}

// Haversine formula — distance in miles between two lat/longs
export function distanceMiles(a: LatLng, b: LatLng): number {
  const R = 3958.8; // Earth radius in miles
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// Pretty-format a distance: "0.3 mi" / "2.5 mi" / "12 mi"
export function formatDistance(miles: number): string {
  if (miles < 0.1) return "less than 0.1 mi";
  if (miles < 1) return `${miles.toFixed(1)} mi`;
  if (miles < 10) return `${miles.toFixed(1)} mi`;
  return `${Math.round(miles)} mi`;
}
