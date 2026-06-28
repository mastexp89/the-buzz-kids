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

// ---------- Place details lookup ----------
// Used by the discover-venues step to fill in address / postcode / phone /
// website for candidates that OSM returned without addr:* tags. Calls the
// Text Search (Advanced) endpoint so we get websiteUri + phone — billed at
// ~$0.032/request but only called when OSM data is missing.

export type GooglePlaceDetails = {
  placeId: string | null;
  address: string | null;
  postcode: string | null;
  phone: string | null;
  website: string | null;
  latitude: number | null;
  longitude: number | null;
  rating: number | null;
  reviewCount: number | null;
};

export async function findPlaceDetails(
  query: string,
): Promise<GooglePlaceDetails | null> {
  const key = process.env.GOOGLE_PLACES_KEY;
  if (!key) return null;

  try {
    const res = await fetch(TEXT_SEARCH_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": key,
        "X-Goog-FieldMask": [
          "places.id",
          "places.formattedAddress",
          "places.addressComponents",
          "places.nationalPhoneNumber",
          "places.websiteUri",
          "places.location",
          "places.rating",
          "places.userRatingCount",
        ].join(","),
      },
      body: JSON.stringify({
        textQuery: query,
        maxResultCount: 1,
        regionCode: "GB",
      }),
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return null;
    const json: any = await res.json();
    const place = json.places?.[0];
    if (!place) return null;

    const postcodeComp = (place.addressComponents ?? []).find(
      (c: any) => Array.isArray(c.types) && c.types.includes("postal_code"),
    );

    return {
      placeId: place.id ?? null,
      address: place.formattedAddress ?? null,
      postcode: postcodeComp?.longText ? String(postcodeComp.longText).toUpperCase() : null,
      phone: place.nationalPhoneNumber ?? null,
      website: place.websiteUri ?? null,
      latitude: typeof place.location?.latitude === "number" ? place.location.latitude : null,
      longitude: typeof place.location?.longitude === "number" ? place.location.longitude : null,
      rating: typeof place.rating === "number" ? place.rating : null,
      reviewCount: typeof place.userRatingCount === "number" ? place.userRatingCount : null,
    };
  } catch {
    return null;
  }
}
