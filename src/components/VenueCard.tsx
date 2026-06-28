"use client";

import Link from "next/link";
import type { Venue } from "@/lib/types";
import { DistancePill } from "./NearMeButton";

export default function VenueCard({ venue, citySlug }: { venue: Venue; citySlug: string }) {
  // Image priority: manual logo > FB cover photo (auto-pulled) > legacy image_url.
  const avatar = venue.logo_url || (venue as any).cover_photo_url || venue.image_url;
  // logo_url is meant to be a square brand mark — show whole.
  // cover_photo_url is usually a FB profile pic (often square logo too) — show whole.
  // image_url tends to be a wider photo — fill the tile.
  const fit: "contain" | "cover" = venue.logo_url || (venue as any).cover_photo_url ? "contain" : "cover";
  return (
    <Link
      href={`/${citySlug}/venues/${venue.slug}`}
      className="card-hover p-4 flex gap-3 items-center lift"
    >
      {avatar ? (
        <div
          className="w-14 h-14 rounded-xl bg-buzz-surface shrink-0"
          style={{
            backgroundImage: `url(${avatar})`,
            backgroundSize: fit,
            backgroundPosition: "center",
            backgroundRepeat: "no-repeat",
          }}
        />
      ) : (
        <div className="w-14 h-14 rounded-xl bg-buzz-surface border border-buzz-border grid place-items-center text-xl shrink-0">🐝</div>
      )}
      <div className="min-w-0 flex-1">
        <div className="font-display text-lg uppercase truncate leading-tight">{venue.name}</div>
        <div className="text-xs text-buzz-mute truncate flex items-center gap-2">
          <span className="truncate">{venue.address || ""}</span>
          <DistancePill lat={(venue as any).latitude} lng={(venue as any).longitude} />
        </div>
      </div>
    </Link>
  );
}
