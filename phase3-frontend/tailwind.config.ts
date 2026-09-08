import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        paper: "rgb(var(--color-paper) / <alpha-value>)",
        surface: "rgb(var(--color-surface) / <alpha-value>)",
        "surface-2": "rgb(var(--color-surface-2) / <alpha-value>)",
        ink: {
          DEFAULT: "rgb(var(--color-ink) / <alpha-value>)",
          soft: "rgb(var(--color-ink-soft) / <alpha-value>)",
          faint: "rgb(var(--color-ink-faint) / <alpha-value>)",
        },
        line: "rgb(var(--color-line) / <alpha-value>)",
        usd: {
          DEFAULT: "rgb(var(--color-usd) / <alpha-value>)",
          soft: "rgb(var(--color-usd-soft) / <alpha-value>)",
        },
        zig: {
          DEFAULT: "rgb(var(--color-zig) / <alpha-value>)",
          soft: "rgb(var(--color-zig-soft) / <alpha-value>)",
        },
        seal: {
          DEFAULT: "rgb(var(--color-seal) / <alpha-value>)",
          soft: "rgb(var(--color-seal-soft) / <alpha-value>)",
        },
        danger: {
          DEFAULT: "rgb(var(--color-danger) / <alpha-value>)",
          soft: "rgb(var(--color-danger-soft) / <alpha-value>)",
        },
      },
      fontFamily: {
        display: ["var(--font-fraunces)", "Georgia", "serif"],
        body: ["var(--font-plex-sans)", "system-ui", "sans-serif"],
        mono: ["var(--font-plex-mono)", "ui-monospace", "monospace"],
      },
      borderRadius: {
        sm: "3px",
        DEFAULT: "4px",
        md: "6px",
        lg: "10px",
        xl: "14px",
      },
      boxShadow: {
        card: "0 1px 2px rgba(20, 16, 8, 0.06), 0 1px 0 rgba(20, 16, 8, 0.04)",
        "card-raised": "0 2px 8px rgba(20, 16, 8, 0.08), 0 1px 0 rgba(20, 16, 8, 0.05)",
      },
      transitionTimingFunction: {
        snap: "cubic-bezier(0.16, 1, 0.3, 1)",
      },
    },
  },
  plugins: [],
};

export default config;
