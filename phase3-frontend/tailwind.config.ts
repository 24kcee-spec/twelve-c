import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        paper: "#F5F6F0",
        surface: "#FFFFFF",
        ink: {
          DEFAULT: "#16241C",
          soft: "#45564B",
          faint: "#7C8B7F",
        },
        line: "#DCD9C9",
        usd: {
          DEFAULT: "#1F6F54",
          soft: "#E4EFE9",
        },
        zig: {
          DEFAULT: "#B87F27",
          soft: "#F5EAD7",
        },
        danger: {
          DEFAULT: "#A8412F",
          soft: "#F3E3DE",
        },
      },
      fontFamily: {
        display: ["var(--font-fraunces)", "Georgia", "serif"],
        body: ["var(--font-plex-sans)", "system-ui", "sans-serif"],
        mono: ["var(--font-plex-mono)", "ui-monospace", "monospace"],
      },
      borderRadius: {
        sm: "2px",
        DEFAULT: "3px",
        md: "5px",
        lg: "8px",
      },
      boxShadow: {
        card: "0 1px 2px rgba(22, 36, 28, 0.06), 0 1px 0 rgba(22, 36, 28, 0.04)",
      },
    },
  },
  plugins: [],
};

export default config;
