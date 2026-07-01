// Compact Google rating trust-signal: ★ 4.6 · 312 Google reviews, linking out
// to the place's Google reviews. Server component — pure display, no state.

export default function GoogleRating({
  rating,
  count,
  placeId,
  name,
}: {
  rating: number | null | undefined;
  count: number | null | undefined;
  placeId: string | null | undefined;
  name: string;
}) {
  if (rating == null) return null;
  const r = Number(rating);
  const full = Math.round(r);
  const stars = "★★★★★".slice(0, full) + "☆☆☆☆☆".slice(0, 5 - full);
  const href = placeId
    ? `https://search.google.com/local/reviews?placeid=${placeId}`
    : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(name)}`;

  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-1.5 text-sm hover:text-buzz-accent transition w-fit"
      title="See this place's reviews on Google"
    >
      <span className="text-amber-500 tracking-tight" aria-hidden>{stars}</span>
      <span className="font-semibold">{r.toFixed(1)}</span>
      <span className="text-buzz-mute">
        {count ? `· ${Number(count).toLocaleString()} Google reviews` : "on Google"}
      </span>
    </a>
  );
}
