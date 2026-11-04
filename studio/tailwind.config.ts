import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: ["class"],
  content: [
    "./src/app/**/*.{ts,tsx}",
    "./src/app/(marketing)/**/*.{ts,tsx}",
    "./src/app/(studio)/**/*.{ts,tsx}",
    "./src/components/**/*.{ts,tsx}",
    "./src/components/marketing/**/*.{ts,tsx}",
    "./src/context/**/*.{ts,tsx}",
    "./src/lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        ink: "var(--st-ink)",
        paper: "var(--st-bg)",
        surface: "var(--st-surface)",
        raised: "var(--st-raised)",
        teal: "var(--st-teal)",
        amber: "var(--st-amber)",
        slateish: "var(--st-slate)",
        crimson: "var(--st-crimson)",
        grey: "var(--st-subtle)",
        border: "var(--st-border)",
        muted: "var(--st-muted-bg)",
        accent: {
          DEFAULT: "var(--st-accent)",
          hover: "var(--st-accent-hover)",
        },
        "ink-muted": "var(--st-muted)",
        "ink-subtle": "var(--st-subtle)",
        hairline: "var(--st-hairline)",
      },
      fontFamily: {
        sans: ["var(--font-inter)", "Inter", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
      boxShadow: {
        panel: "0 1px 2px rgba(16, 27, 45, 0.06)",
      },
      screens: {
        mk: "900px",
        nav: "821px",
      },
    },
  },
  plugins: [],
};

export default config;
