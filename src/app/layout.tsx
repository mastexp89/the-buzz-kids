import type { Metadata, Viewport } from "next";
import Script from "next/script";
import { Bebas_Neue, Inter, Pacifico } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import "./globals.css";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import { NearMeProvider } from "@/components/NearMeContext";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
const bebas = Bebas_Neue({ subsets: ["latin"], weight: "400", variable: "--font-bebas", display: "swap" });
const pacifico = Pacifico({ subsets: ["latin"], weight: "400", variable: "--font-pacifico", display: "swap" });

export const metadata: Metadata = {
  title: "The Buzz Guide — Gigs, DJs & nights out",
  description:
    "Find what's on tonight at your local pubs and venues. Gigs, DJs, karaoke, quizzes — filter by genre, date or venue.",
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000"),
  manifest: "/manifest.webmanifest",
  icons: {
    icon: "/logo.png",
    apple: "/logo.png",
  },
  appleWebApp: {
    capable: true,
    title: "The Buzz Guide",
    statusBarStyle: "black-translucent",
  },
  openGraph: {
    title: "The Buzz Guide — Gigs, DJs & nights out",
    description: "Find what's on tonight at your local pubs and venues.",
    type: "website",
    images: ["/logo.png"],
  },
};

export const viewport: Viewport = {
  themeColor: "#000000",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover", // Required for iOS notch / safe-area-inset
  maximumScale: 1, // Prevent annoying double-tap zoom inside the app shell
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${bebas.variable} ${pacifico.variable}`}>
      <body className="min-h-screen flex flex-col font-sans antialiased">
        <NearMeProvider>
          <Navbar />
          <main className="flex-1">{children}</main>
          <Footer />
        </NearMeProvider>
        <Analytics />
        <SpeedInsights />
        <Script src="https://control-room-php6.onrender.com/px.js" strategy="afterInteractive" />
      </body>
    </html>
  );
}
