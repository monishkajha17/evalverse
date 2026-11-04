import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: ["class"],
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#101B2D",
        paper: "#F4F6F9",
        teal: "#0B8F7A",
        amber: "#C98512",
        slateish: "#6A7B93",
        crimson: "#D4285C",
        grey: "#A9B3C1",
        border: "#D7DDE7",
        muted: "#EEF1F5",
      },
      fontFamily: {
        sans: ["var(--font-inter)", "Inter", "system-ui", "sans-serif"],
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
      boxShadow: {
        panel: "0 1px 2px rgba(16, 27, 45, 0.06)",
      },
    },
  },
  plugins: [],
};

export default config;
