// Google Places API (New) helper — find a place by text and pull one of its
// photos. Server-only (uses GOOGLE_PLACES_KEY). Used to auto-populate a photo
// for venues in the Places directory before an organiser uploads their own.
//
// Docs: https://developers.google.com/maps/documentation/places/web-service/text-search
//       https://developers.google.com/maps/documentation/places/web-service/place-photos

const TEXT_SEARCH_URL = "https://places.googleapis.com/v1/places:searchText";

export type GooglePlaceResult = {
  placeId: string;
  photoUrl: string | null;        // resolved photoUri (googleusercontent URL)
  attribution: string | null;     // author name to display with the photo
};

// Find the best-matching place for a free-text query (e.g. "Camperdown
// Wildlife Centre, Dundee") and return its id + first photo. Returns null when
// nothing matches. Throws on a missing key or a hard API error.
export async function findPlacePhoto(query: string): Promise<GooglePlaceResult | null> {
  const key = process.env.GOOGLE_PLACES_KEY;
  if (!key) throw new Error("GOOGLE_PLACES_KEY env var missing.");

  const res = await fetch(TEXT_SEARCH_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": key,
      // Field mask keeps the response (and billing tier) minimal.
      "X-Goog-FieldMask": "places.id,places.displayName,places.photos",
    },
    body: JSON.stringify({ textQuery: query, maxResultCount: 1, regionCode: "GB" }),
  });
  if (!res.ok) {
    throw new Error(`Places searchText ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  const json: any = await res.json();
  const place = json.places?.[0];
  if (!place?.id) return null;

  let photoUrl: string | null = null;
  let attribution: string | null = null;
  const photo = place.photos?.[0];
  if (photo?.name) {
    attribution = photo.authorAttributions?.[0]?.displayName ?? null;
    // skipHttpRedirect=true → JSON with a photoUri instead of a 302 to the image.
    const mediaRes = await fetch(
      `https://places.googleapis.com/v1/${photo.name}/media?maxWidthPx=900&skipHttpRedirect=true`,
      { headers: { "X-Goog-Api-Key": key } },
    );
    if (mediaRes.ok) {
      const mj: any = await mediaRes.json();
      photoUrl = mj.photoUri ?? null;
    }
  }

  return { placeId: place.id, photoUrl, attribution };
}

// Build the search query for a venue from the fields we have.
export function venueSearchQuery(v: {
  name: string;
  address?: string | null;
  postcode?: string | null;
  cityName?: string | null;
}): string {
  const tail = v.address || v.postcode || v.cityName || "Scotland";
  return `${v.name}, ${tail}`;
}
