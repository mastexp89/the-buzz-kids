import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        buzz: {
          bg: "#000000",          // pure black — matches logo
          surface: "#0e0e10",     // very dark for cards behind cards
          card: "#161618",        // card surfaces
          border: "#26262a",      // subtle dividers
          text: "#f5f5f0",        // warm off-white
          mute: "#8a8a92",
          accent: "#fdb913",      // honey gold — exact from logo
          accent2: "#ff9c00",     // deeper orange for hovers/highlights
          good: "#06d6a0",
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
