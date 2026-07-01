"use server";

// Google Places (New) autocomplete + details, used by the venue form so a
// person adding a place can type its name and click the right address to
// auto-fill address, postcode, phone and website. Key stays server-side.

import { createClient } from "@/lib/supabase/server";

async function requireUser() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  return user;
}

export type PlaceSuggestion = {
  placeId: string;
  main: string;
  secondary: string;
};

export async function placeAutocomplete(query: string): Promise<{ results: PlaceSuggestion[] }> {
  const key = process.env.GOOGLE_PLACES_KEY;
  const q = query.trim();
  if (!key || q.length < 3) return { results: [] };
  if (!(await requireUser())) return { results: [] };
  try {
    const res = await fetch("https://places.googleapis.com/v1/places:autocomplete", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Goog-Api-Key": key },
      body: JSON.stringify({ input: q, includedRegionCodes: ["gb"] }),
    });
    const j = await res.json();
    const results: PlaceSuggestion[] = (j.suggestions ?? [])
      .map((s: any) => s.placePrediction)
      .filter(Boolean)
      .map((p: any) => ({
        placeId: p.placeId,
        main: p.structuredFormat?.mainText?.text ?? p.text?.text ?? "",
        secondary: p.structuredFormat?.secondaryText?.text ?? "",
      }));
    return { results };
  } catch {
    return { results: [] };
  }
}

export type PlaceDetails = {
  name: string;
  address: string;
  postcode: string;
  phone: string;
  website: string;
  googlePlaceId: string;
  latitude: number | null;
  longitude: number | null;
};

export async function placeDetails(placeId: string): Promise<{ place?: PlaceDetails; error?: string }> {
  const key = process.env.GOOGLE_PLACES_KEY;
  if (!key) return { error: "Places lookup isn't configured." };
  if (!(await requireUser())) return { error: "Not signed in." };
  try {
    const fields =
      "id,displayName,formattedAddress,addressComponents,nationalPhoneNumber,internationalPhoneNumber,websiteUri,location";
    const res = await fetch(
      `https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}?fields=${fields}`,
      { headers: { "X-Goog-Api-Key": key } }
    );
    const j = await res.json();
    if (j.error) return { error: j.error.message };
    const postcode =
      (j.addressComponents ?? []).find((c: any) => (c.types ?? []).includes("postal_code"))?.longText ?? "";
    return {
      place: {
        name: j.displayName?.text ?? "",
        address: j.formattedAddress ?? "",
        postcode,
        phone: j.nationalPhoneNumber ?? j.internationalPhoneNumber ?? "",
        website: j.websiteUri ?? "",
        googlePlaceId: j.id ?? placeId,
        latitude: j.location?.latitude ?? null,
        longitude: j.location?.longitude ?? null,
      },
    };
  } catch {
    return { error: "Couldn't fetch place details." };
  }
}
