"use client";

// Renders the event-page hero poster with a working fallback.
//
// CSS background-image silently shows nothing on a 404 — common with
// older Facebook-scraped events because FB's signed image URLs rot
// after a while. Using an <img> tag lets us catch the load failure
// via onError and render the themed icon instead, so the page never
// shows a blank rectangle.

import { useState } from "react";

export default function EventHeroImage({
  imageUrl,
  title,
  venueName,
  fallbackIcon,
}: {
  imageUrl: string | null;
  title: string;
  venueName: string;
  fallbackIcon: string;
}) {
  // "broken" = the img element fired onError, so we should render the
  // themed fallback instead of trying again.
  const [broken, setBroken] = useState(false);
  const showFallback = !imageUrl || broken;

  if (showFallback) {
    return (
      <div className="absolute inset-0 grid place-items-center bg-gradient-to-br from-buzz-card to-buzz-bg">
        <div className="text-center px-8">
          <div className="text-7xl text-buzz-accent/60 mb-4">{fallbackIcon}</div>
          <div className="font-display text-4xl uppercase leading-none">{title}</div>
          <div className="font-script text-2xl text-buzz-accent mt-4">at {venueName}</div>
        </div>
      </div>
    );
  }

  return (
    <img
      src={imageUrl}
      alt=""
      onError={() => setBroken(true)}
      className="absolute inset-0 w-full h-full object-cover"
      loading="eager"
    />
  );
}
