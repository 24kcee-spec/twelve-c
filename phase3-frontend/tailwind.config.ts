import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        paper: "rgb(var(--color-paper) / <alpha-value>)",
        surface: "rgb(var(--color-surface) / <alpha-value>)",
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
        sm: "4px",
        DEFAULT: "8px",
        md: "12px",
        lg: "18px",
        xl: "24px",
      },
      boxShadow: {
        card: "0 1px 2px rgba(0, 0, 0, 0.06), 0 1px 0 rgba(255, 255, 255, 0.03)",
        "glow-usd": "0 0 0 1px rgb(var(--glow-usd) / 0.4), 0 0 24px rgb(var(--glow-usd) / 0.35)",
        "glow-zig": "0 0 0 1px rgb(var(--glow-zig) / 0.4), 0 0 24px rgb(var(--glow-zig) / 0.35)",
        "glow-sm": "0 0 12px rgb(var(--glow-usd) / 0.25)",
      },
      backgroundImage: {
        "signal-gradient": "linear-gradient(135deg, rgb(var(--color-usd)), rgb(var(--color-zig)))",
      },
      transitionTimingFunction: {
        snap: "cubic-bezier(0.16, 1, 0.3, 1)",
      },
    },
  },
  plugins: [],
};

export default config;
