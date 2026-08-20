/** @type {import('next').NextConfig} */
const nextConfig = {
  // Pin the workspace root. A stray package-lock.json further up the tree made
  // Turbopack infer the wrong root, which 404'd every /api route in local dev
  // (pages still worked, so it looked like a routing bug).
  turbopack: { root: __dirname },
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "**.supabase.co" },
      { protocol: "https", hostname: "images.unsplash.com" },
      // Google Places photos — the source for ~950 venue images.
      { protocol: "https", hostname: "lh3.googleusercontent.com" },
      { protocol: "https", hostname: "*.googleusercontent.com" },
    ],
  },
  // Retired music-era routes (carried over from The Buzz Guide). Kept out of
  // the public site + search index by sending them to their kids equivalents.
  async redirects() {
    return [
      { source: "/artists", destination: "/organisers", permanent: true },
      { source: "/artists/:path*", destination: "/organisers", permanent: true },
      { source: "/festivals", destination: "/browse", permanent: true },
      { source: "/festivals/:path*", destination: "/browse", permanent: true },
      { source: "/sponsors", destination: "/browse", permanent: true },
      { source: "/sponsors/:path*", destination: "/browse", permanent: true },
      { source: "/submit-gig", destination: "/list-your-activity", permanent: true },
      { source: "/submit-gig/:path*", destination: "/list-your-activity", permanent: true },
    ];
  },
};

module.exports = nextConfig;
