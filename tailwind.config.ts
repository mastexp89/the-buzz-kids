import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        buzz: {
          // --- Light & bright base (cool white, from the logo's sky/star blue) ---
          bg: "#F2F9FE",          // soft cool-white page background
          surface: "#E8F2FA",     // cool tint for secondary panels / inputs / chips
          card: "#FFFFFF",        // white cards pop on the cool page
          border: "#DCEAF3",      // cool hairline divider
          text: "#16202A",        // cool near-black ink
          mute: "#647682",        // muted cool grey

          // --- Brand accents (from logo) ---
          accent: "#1FA9E0",      // sky blue — primary CTA / active
          accent2: "#1689BC",     // deeper blue for hovers
          pink: "#EC1E8C",        // magenta — category accents, hearts
          cyan: "#1FA9E0",        // sky cyan (same as accent)
          lime: "#8CC63F",        // lime green
          yellow: "#FFD23F",      // sunny yellow — highlights
          gold: "#F9A11B",        // honey gold — now just one of the accents
          good: "#2E9E33",        // green for "free" / success states
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
