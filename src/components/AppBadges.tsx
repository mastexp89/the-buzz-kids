// App Store + Play Store download badges.
//
// Both stores are live → clickable badges. iOS URL has the country
// code stripped so Apple auto-redirects to the user's regional store.
//
// Two sizes:
//   - "hero" (default) — bigger, designed for homepage hero
//   - "compact" — smaller, footer-friendly

import Link from "next/link";

const IOS_APP_URL = "https://apps.apple.com/app/the-buzz-guide/id6766128325";
const ANDROID_APP_URL = "https://play.google.com/store/apps/details?id=uk.co.thebuzzguide.app";

type Size = "hero" | "compact";

export default function AppBadges({ size = "hero" }: { size?: Size }) {
  const h = size === "hero" ? 56 : 40;

  return (
    <div className="flex flex-wrap items-center gap-3">
      <a
        href={IOS_APP_URL}
        target="_blank"
        rel="noopener noreferrer"
        aria-label="Download on the App Store"
        className="inline-block hover:opacity-90 transition"
        style={{ height: h }}
      >
        <AppleBadge height={h} />
      </a>
      <a
        href={ANDROID_APP_URL}
        target="_blank"
        rel="noopener noreferrer"
        aria-label="Get it on Google Play"
        className="inline-block hover:opacity-90 transition"
        style={{ height: h }}
      >
        <GooglePlayBadge height={h} />
      </a>
    </div>
  );
}

// Apple's official "Download on the App Store" badge — inline SVG. Black
// background, white text. Matches Apple's guidelines (rounded rect, two
// lines of text, Apple logo bottom-right).
function AppleBadge({ height }: { height: number }) {
  // SVG viewport: 120 wide × 40 tall — official Apple proportions.
  const w = height * (120 / 40);
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={w}
      height={height}
      viewBox="0 0 120 40"
      role="img"
      aria-hidden
    >
      <rect width="120" height="40" rx="6" ry="6" fill="#000" />
      <rect
        x="0.5"
        y="0.5"
        width="119"
        height="39"
        rx="5.5"
        ry="5.5"
        fill="none"
        stroke="#A6A6A6"
        strokeWidth="0.5"
      />
      {/* Apple logo */}
      <path
        d="M22.5 20.7c0-2 1.6-3 1.7-3-0.9-1.3-2.3-1.5-2.8-1.5-1.2-0.1-2.3 0.7-2.9 0.7-0.6 0-1.5-0.7-2.5-0.7-1.3 0-2.5 0.7-3.1 1.9-1.3 2.3-0.3 5.7 1 7.5 0.6 0.9 1.3 1.9 2.3 1.9 0.9 0 1.3-0.6 2.4-0.6 1.1 0 1.4 0.6 2.4 0.6 1 0 1.6-0.9 2.2-1.8 0.7-1 1-2.1 1-2.2-0.1-0.1-1.7-0.7-1.7-2.8zM20.7 14.9c0.5-0.6 0.9-1.5 0.8-2.4-0.7 0-1.6 0.5-2.1 1.1-0.5 0.5-0.9 1.4-0.8 2.2 0.8 0.1 1.6-0.4 2.1-0.9z"
        fill="#fff"
      />
      {/* "Download on the" line */}
      <text
        x="32"
        y="16"
        fontSize="6.5"
        fontFamily="-apple-system, Helvetica, Arial, sans-serif"
        fill="#fff"
      >
        Download on the
      </text>
      {/* "App Store" line */}
      <text
        x="32"
        y="28"
        fontSize="13"
        fontWeight="600"
        fontFamily="-apple-system, Helvetica, Arial, sans-serif"
        fill="#fff"
      >
        App Store
      </text>
    </svg>
  );
}

// Google's "Get it on Google Play" badge — inline SVG. Black background,
// white text, official Play triangle logo. Mirrors the Apple badge so
// the pair sit visually balanced.
function GooglePlayBadge({ height }: { height: number }) {
  const w = height * (135 / 40);
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={w}
      height={height}
      viewBox="0 0 135 40"
      role="img"
      aria-hidden
    >
      <rect width="135" height="40" rx="6" ry="6" fill="#000" />
      <rect
        x="0.5"
        y="0.5"
        width="134"
        height="39"
        rx="5.5"
        ry="5.5"
        fill="none"
        stroke="#A6A6A6"
        strokeWidth="0.5"
      />
      {/* Google Play triangle logo */}
      <g transform="translate(10, 8) scale(0.18)">
        <path d="M0 0 L0 130 L65 65 Z" fill="#00D9FF" />
        <path d="M0 130 L65 65 L100 100 L20 145 Z" fill="#FF3B45" />
        <path d="M0 0 L65 65 L100 30 L20 -15 Z" fill="#FFD740" />
        <path d="M65 65 L100 30 L130 65 L100 100 Z" fill="#00C853" />
      </g>
      {/* Text */}
      <text
        x="35"
        y="16"
        fontSize="6.5"
        fontFamily="Roboto, Helvetica, Arial, sans-serif"
        fill="#fff"
      >
        Get it on
      </text>
      <text
        x="35"
        y="28"
        fontSize="13"
        fontWeight="600"
        fontFamily="Roboto, Helvetica, Arial, sans-serif"
        fill="#fff"
      >
        Google Play
      </text>
    </svg>
  );
}
