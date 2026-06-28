// Spotify embed iframe.
//
// Spotify embeds work for artist / track / album / playlist URLs simply
// by injecting "/embed" into the path:
//   https://open.spotify.com/artist/XYZ
//   → https://open.spotify.com/embed/artist/XYZ
//
// Anything that isn't a parseable open.spotify.com URL renders nothing —
// the caller is expected to handle the "no spotify URL" case.

function spotifyEmbedSrc(rawUrl: string): string | null {
  try {
    const u = new URL(rawUrl);
    if (!u.hostname.endsWith("spotify.com")) return null;
    // Already an embed URL.
    if (u.pathname.startsWith("/embed/")) return u.toString();
    // /artist/X /track/X /album/X /playlist/X /show/X /episode/X — just prefix /embed.
    return `https://open.spotify.com/embed${u.pathname}${u.search}`;
  } catch {
    return null;
  }
}

/**
 * Embedded Spotify player. Tall variant (352px) shows up to 5 tracks
 * inline; compact (152px) is a single-row player. Pages can pick either
 * via the `compact` prop. Defaults to tall — more useful on an artist
 * page where the visitor wants to sample tracks.
 */
export default function SpotifyEmbed({
  url,
  compact = false,
}: {
  url: string;
  compact?: boolean;
}) {
  const src = spotifyEmbedSrc(url);
  if (!src) return null;
  const height = compact ? 152 : 352;
  return (
    <iframe
      src={src}
      width="100%"
      height={height}
      style={{ borderRadius: "12px", border: 0 }}
      allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
      loading="lazy"
      title="Spotify player"
    />
  );
}
