"use client";

import { createContext, useContext, useEffect, useState, ReactNode } from "react";

export type Theme = "light" | "dark" | "system";
type Resolved = "light" | "dark";

type ThemeContextValue = {
  theme: Theme;
  resolvedTheme: Resolved;
  setTheme: (theme: Theme) => void;
};

const STORAGE_KEY = "twelve-c-theme";

const ThemeContext = createContext<ThemeContextValue | null>(null);

function systemPrefersDark(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function resolve(theme: Theme): Resolved {
  return theme === "system" ? (systemPrefersDark() ? "dark" : "light") : theme;
}

function applyToDocument(resolved: Resolved) {
  document.documentElement.classList.toggle("dark", resolved === "dark");
}

/**
 * Wrap the app once, in layout.tsx. A small inline script (see layout.tsx)
 * already set the "dark" class on <html> before hydration, so there is no
 * flash of the wrong theme - this provider just takes over from there and
 * gives every component a way to read/change the theme.
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>("system");
  const [resolvedTheme, setResolvedTheme] = useState<Resolved>("light");

  useEffect(() => {
    const stored = (localStorage.getItem(STORAGE_KEY) as Theme | null) ?? "system";
    setThemeState(stored);
    const resolved = resolve(stored);
    setResolvedTheme(resolved);
    applyToDocument(resolved);

    const media = window.matchMedia("(prefers-color-scheme: dark)");
    function onSystemChange() {
      setThemeState((current) => {
        if (current === "system") {
          const next = resolve("system");
          setResolvedTheme(next);
          applyToDocument(next);
        }
        return current;
      });
    }
    media.addEventListener("change", onSystemChange);
    return () => media.removeEventListener("change", onSystemChange);
  }, []);

  function setTheme(next: Theme) {
    localStorage.setItem(STORAGE_KEY, next);
    setThemeState(next);
    const resolved = resolve(next);
    setResolvedTheme(resolved);
    applyToDocument(resolved);
  }

  return (
    <ThemeContext.Provider value={{ theme, resolvedTheme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within a ThemeProvider");
  return ctx;
}
