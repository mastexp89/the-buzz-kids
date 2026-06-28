"use client";

import { createContext, useContext, useEffect, useState, ReactNode, useCallback } from "react";
import { distanceMiles, formatDistance, type LatLng } from "@/lib/geocode";

type SortMode = "time" | "distance";

type State = {
  here: LatLng | null;
  loading: boolean;
  error: string | null;
  sort: SortMode;
  setSort: (s: SortMode) => void;
  request: () => void;
  clear: () => void;
  /** Compute distance from current location to a venue, formatted */
  distanceTo: (lat: number | null | undefined, lng: number | null | undefined) => string | null;
  /** Raw miles */
  rawDistanceTo: (lat: number | null | undefined, lng: number | null | undefined) => number | null;
};

const NearMeContext = createContext<State>({
  here: null,
  loading: false,
  error: null,
  sort: "time",
  setSort: () => {},
  request: () => {},
  clear: () => {},
  distanceTo: () => null,
  rawDistanceTo: () => null,
});

const STORAGE_KEY = "buzz:near-me";

export function NearMeProvider({ children }: { children: ReactNode }) {
  const [here, setHere] = useState<LatLng | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sort, setSort] = useState<SortMode>("time");

  // Restore from sessionStorage so the user doesn't get prompted on every page nav
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      if (raw) setHere(JSON.parse(raw));
    } catch {}
  }, []);

  const request = useCallback(() => {
    if (!("geolocation" in navigator)) {
      setError("Your browser doesn't support location.");
      return;
    }
    setLoading(true);
    setError(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const next = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        setHere(next);
        try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch {}
        setLoading(false);
      },
      (err) => {
        setError(err.message ?? "Couldn't get your location.");
        setLoading(false);
      },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 60_000 * 5 },
    );
  }, []);

  const clear = useCallback(() => {
    setHere(null);
    try { sessionStorage.removeItem(STORAGE_KEY); } catch {}
  }, []);

  const rawDistanceTo = useCallback(
    (lat: number | null | undefined, lng: number | null | undefined) => {
      if (!here || typeof lat !== "number" || typeof lng !== "number") return null;
      return distanceMiles(here, { lat, lng });
    },
    [here],
  );

  const distanceTo = useCallback(
    (lat: number | null | undefined, lng: number | null | undefined) => {
      const m = rawDistanceTo(lat, lng);
      return m === null ? null : formatDistance(m);
    },
    [rawDistanceTo],
  );

  return (
    <NearMeContext.Provider value={{ here, loading, error, sort, setSort, request, clear, distanceTo, rawDistanceTo }}>
      {children}
    </NearMeContext.Provider>
  );
}

export function useNearMe() {
  return useContext(NearMeContext);
}
