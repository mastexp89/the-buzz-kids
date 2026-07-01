/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "**.supabase.co" },
      { protocol: "https", hostname: "images.unsplash.com" },
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
