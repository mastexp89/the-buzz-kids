import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        buzz: {
          // --- Light & bright base (from The Buzz Kids logo) ---
          bg: "#FFFDF7",          // warm cream page background
          surface: "#FFF6E6",     // soft warm tint for secondary panels / inputs
          card: "#FFFFFF",        // white cards pop on the cream page
          border: "#EFE4CC",      // warm hairline divider
          text: "#1F1B16",        // warm near-black ink
          mute: "#7A736A",        // muted warm grey

          // --- Brand accents (exact from logo) ---
          accent: "#F9A11B",      // honey gold — primary CTA / badge
          accent2: "#F2820D",     // deeper orange for hovers
          pink: "#EC1E8C",        // magenta — category accents, hearts
          cyan: "#1FA9E0",        // sky cyan — dates, links, the star
          lime: "#8CC63F",        // lime green
          yellow: "#FFD23F",      // sunny yellow — highlights
          good: "#5BA012",        // green for "free" / success states
        },
      },
      fontFamily: {
        sans: ["var(--font-inter)", "ui-sans-serif", "system-ui", "sans-serif"],
        display: ["var(--font-bebas)", "Impact", "Helvetica Neue", "sans-serif"],
        script: ["var(--font-pacifico)", "cursive"],
      },
    },
  },
  plugins: [],
};

export default config;
