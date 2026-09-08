# Twelve C - Dashboard visual overhaul
# Rewrites: globals.css, tailwind.config.ts, ui.tsx, TopBar.tsx,
# OverdueDigest.tsx, dashboard/page.tsx
# Run: powershell -ExecutionPolicy Bypass -File .\apply_patch.ps1

$repoRoot = (Get-ChildItem -Path C:\ -Recurse -Filter "twelve-c" -Directory -ErrorAction SilentlyContinue |
  Where-Object { Test-Path (Join-Path $_.FullName "phase3-frontend") } |
  Select-Object -First 1).FullName

if (-not $repoRoot) {
  Write-Host "Could not auto-detect repo root. Set `$repoRoot manually and re-run." -ForegroundColor Red
  exit 1
}

Write-Host "Repo root: $repoRoot"
$frontend = Join-Path $repoRoot "phase3-frontend"


# ---- src/app/globals.css ----
$fullPath = (Get-ChildItem -LiteralPath $frontend -Recurse -Filter "globals.css" -File |
  Where-Object { $_.FullName -replace [regex]::Escape($frontend), "" -replace "\\","/" -match "src/app/globals.css$" } |
  Select-Object -First 1).FullName
if (-not $fullPath) { Write-Host "NOT FOUND: src/app/globals.css" -ForegroundColor Red; exit 1 }
$content = @'
@tailwind base;
@tailwind components;
@tailwind utilities;

/* ---------------------------------------------------------------------
   "The Ledger" - a ruled passbook aesthetic, not a glass panel. Warm
   parchment paper, aged-gold seal reserved for the logo and confirmed/
   verified states, and a faint ruled-line body texture. Dark mode
   ("Night Ledger") uses a three-step surface hierarchy - paper, surface,
   surface-2 - so nested elements (asset register rows, modals) read as
   physically stacked rather than just a lighter blur.
   --------------------------------------------------------------------- */
:root {
  --color-paper: 245 240 227;
  --color-surface: 253 250 242;
  --color-surface-2: 245 240 227;
  --color-ink: 36 29 20;
  --color-ink-soft: 91 82 66;
  --color-ink-faint: 140 129 108;
  --color-line: 214 202 172;
  --color-usd: 31 111 84;
  --color-usd-soft: 226 239 231;
  --color-zig: 45 90 120;
  --color-zig-soft: 224 233 240;
  --color-seal: 163 116 30;
  --color-seal-soft: 243 232 205;
  --color-danger: 168 65 47;
  --color-danger-soft: 243 227 222;
}

html.dark {
  --color-paper: 23 19 16;
  --color-surface: 32 26 20;
  --color-surface-2: 41 34 26;
  --color-ink: 237 229 214;
  --color-ink-soft: 184 173 149;
  --color-ink-faint: 138 128 105;
  --color-line: 58 50 38;
  --color-usd: 79 174 138;
  --color-usd-soft: 27 45 38;
  --color-zig: 111 160 196;
  --color-zig-soft: 25 40 51;
  --color-seal: 212 169 76;
  --color-seal-soft: 46 37 20;
  --color-danger: 226 133 122;
  --color-danger-soft: 51 27 22;
}

html {
  color-scheme: light;
}
html.dark {
  color-scheme: dark;
}

body {
  background-color: rgb(var(--color-paper));
  color: rgb(var(--color-ink));
  transition: background-color 200ms ease, color 200ms ease;
  position: relative;
}

/* Faint ruled-line texture, like feint-ruled ledger paper. Fixed behind
   everything, purely decorative. */
body::before {
  content: "";
  position: fixed;
  inset: 0;
  z-index: -1;
  pointer-events: none;
  background-image: repeating-linear-gradient(
    rgb(var(--color-line) / 0.5) 0px,
    rgb(var(--color-line) / 0.5) 1px,
    transparent 1px,
    transparent 28px
  );
}
html.dark body::before {
  background-image: repeating-linear-gradient(
    rgb(var(--color-line) / 0.32) 0px,
    rgb(var(--color-line) / 0.32) 1px,
    transparent 1px,
    transparent 28px
  );
}

::selection {
  background-color: rgb(var(--color-seal) / 0.35);
  color: rgb(var(--color-ink));
}

.tabular-nums {
  font-variant-numeric: tabular-nums;
}

.rule {
  border-color: rgb(var(--color-line));
}

@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}

:focus-visible {
  outline: 2px solid rgb(var(--color-seal));
  outline-offset: 2px;
  border-radius: 2px;
}

input[type="number"] {
  -moz-appearance: textfield;
}
input[type="number"]::-webkit-outer-spin-button,
input[type="number"]::-webkit-inner-spin-button {
  -webkit-appearance: none;
  margin: 0;
}

@media print {
  @page {
    margin: 1.5cm;
  }
  body {
    background: white;
    color: black;
  }
  body::before {
    display: none;
  }
}

@keyframes fadeInUp {
  from { opacity: 0; transform: translateY(6px); }
  to { opacity: 1; transform: translateY(0); }
}
.fade-in-up {
  animation: fadeInUp 400ms ease-out both;
}

@media (prefers-reduced-motion: reduce) {
  .fade-in-up { animation: none; }
}

/* Letterhead rule - a seal-gold top border used on cards and headers in
   place of drop shadows / glow. Reads as a stamped ledger sheet. */
.letterhead {
  border-top: 2px solid rgb(var(--color-seal));
}

/* Stamp-style badge for confirmed/verified states (MFA enabled, payment
   recorded, email verified). Deliberately the only place besides the
   logo that uses seal gold, so it always signals "this is official". */
.seal-mark {
  display: inline-flex;
  align-items: center;
  gap: 0.375rem;
  border: 1px solid rgb(var(--color-seal) / 0.5);
  background: rgb(var(--color-seal-soft));
  color: rgb(var(--color-seal));
  border-radius: 999px;
  padding: 0.125rem 0.625rem;
  font-family: var(--font-plex-mono), ui-monospace, monospace;
  font-size: 0.6875rem;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

/* Ink-stamp badge for genuinely urgent states (overdue instalments).
   The danger-toned counterpart to .seal-mark - rotated slightly, like a
   rubber stamp pressed at an angle. Reserved for real urgency so it
   keeps its impact instead of becoming another pill. */
.stamp-mark {
  display: inline-flex;
  align-items: center;
  gap: 0.375rem;
  border: 2px solid rgb(var(--color-danger));
  background: rgb(var(--color-danger) / 0.1);
  color: rgb(var(--color-danger));
  border-radius: 8px;
  padding: 0.4rem 0.8rem;
  font-family: var(--font-plex-mono), ui-monospace, monospace;
  font-size: 0.75rem;
  font-weight: 600;
  letter-spacing: 0.01em;
  transform: rotate(-4deg);
}

@keyframes stampIn {
  from { opacity: 0; transform: rotate(-4deg) scale(1.18); }
  to { opacity: 1; transform: rotate(-4deg) scale(1); }
}
.stamp-in {
  animation: stampIn 500ms cubic-bezier(0.16, 1, 0.3, 1) both;
}

.scrollbar-thin {
  scrollbar-width: thin;
  scrollbar-color: rgb(var(--color-line)) transparent;
}
.scrollbar-thin::-webkit-scrollbar {
  width: 6px;
}
.scrollbar-thin::-webkit-scrollbar-track {
  background: transparent;
}
.scrollbar-thin::-webkit-scrollbar-thumb {
  background-color: rgb(var(--color-line));
  border-radius: 999px;
}
.scrollbar-thin::-webkit-scrollbar-thumb:hover {
  background-color: rgb(var(--color-ink-faint));
}

'@
$content = $content -replace "ELLIPSIS", [char]0x2026
[System.IO.File]::WriteAllText($fullPath, $content, (New-Object System.Text.UTF8Encoding($false)))
Write-Host "Wrote: $fullPath"


# ---- tailwind.config.ts ----
$fullPath = (Get-ChildItem -LiteralPath $frontend -Recurse -Filter "tailwind.config.ts" -File |
  Where-Object { $_.FullName -replace [regex]::Escape($frontend), "" -replace "\\","/" -match "/tailwind.config.ts$" } |
  Select-Object -First 1).FullName
if (-not $fullPath) { Write-Host "NOT FOUND: tailwind.config.ts" -ForegroundColor Red; exit 1 }
$content = @'
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
        card: "0 1px 3px rgba(20, 16, 8, 0.08), 0 1px 0 rgba(20, 16, 8, 0.04)",
        "card-raised": "0 12px 28px -16px rgba(20, 16, 8, 0.25), 0 2px 6px rgba(20, 16, 8, 0.08)",
        hero: "0 24px 48px -28px rgba(20, 15, 6, 0.55), 0 2px 6px rgba(20, 15, 6, 0.25)",
      },
      transitionTimingFunction: {
        snap: "cubic-bezier(0.16, 1, 0.3, 1)",
      },
    },
  },
  plugins: [],
};

export default config;

'@
$content = $content -replace "ELLIPSIS", [char]0x2026
[System.IO.File]::WriteAllText($fullPath, $content, (New-Object System.Text.UTF8Encoding($false)))
Write-Host "Wrote: $fullPath"


# ---- src/components/ui.tsx ----
$fullPath = (Get-ChildItem -LiteralPath $frontend -Recurse -Filter "ui.tsx" -File |
  Where-Object { $_.FullName -replace [regex]::Escape($frontend), "" -replace "\\","/" -match "src/components/ui.tsx$" } |
  Select-Object -First 1).FullName
if (-not $fullPath) { Write-Host "NOT FOUND: src/components/ui.tsx" -ForegroundColor Red; exit 1 }
$content = @'
"use client";

import Link from "next/link";
import {
  InputHTMLAttributes,
  ButtonHTMLAttributes,
  ReactNode,
  useEffect,
  useRef,
  useState,
} from "react";
import { LogoMark } from "@/components/LogoMark";

export function Logo({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 font-display text-xl tracking-tight text-ink ${className}`}>
      <LogoMark size={22} />
      Twelve<span className="text-seal">C</span>
    </span>
  );
}

export function Field({
  label,
  hint,
  emptyIfZero,
  value,
  placeholder,
  ...props
}: {
  label: string;
  hint?: string;
  /** For currency-style number fields: show a blank box with a "0.00"
   *  placeholder instead of a literal "0" sitting in the field. Purely
   *  cosmetic - the bound value is still 0 underneath. */
  emptyIfZero?: boolean;
} & InputHTMLAttributes<HTMLInputElement>) {
  const displayValue = emptyIfZero && (value === 0 || value === "0") ? "" : value;
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-ink-soft">{label}</span>
      <input
        {...props}
        value={displayValue}
        placeholder={emptyIfZero ? "0.00" : placeholder}
        className={`w-full rounded border border-line bg-surface px-3 py-2 font-mono text-sm text-ink outline-none transition focus:border-seal placeholder:text-ink-faint/50 ${props.className ?? ""}`}
      />
      {hint && <span className="mt-1 block text-xs text-ink-faint">{hint}</span>}
    </label>
  );
}

export function Button({
  variant = "primary",
  className = "",
  ...props
}: { variant?: "primary" | "secondary" | "ghost" } & ButtonHTMLAttributes<HTMLButtonElement>) {
  const base =
    "inline-flex items-center justify-center rounded px-4 py-2 text-sm font-semibold transition duration-150 ease-snap disabled:opacity-50 disabled:cursor-not-allowed";
  const variants: Record<string, string> = {
    // Warms to seal gold on hover instead of glowing - a stamp being
    // pressed, not a light turning on.
    primary: "bg-ink text-paper hover:bg-seal hover:text-ink",
    secondary: "border border-ink text-ink hover:bg-ink hover:text-paper",
    ghost: "text-ink-soft hover:text-ink",
  };
  return <button {...props} className={`${base} ${variants[variant]} ${className}`} />;
}

export function Card({
  children,
  className = "",
  letterhead = false,
}: {
  children: React.ReactNode;
  className?: string;
  /** Adds the seal-gold top rule, for a card that represents something
   *  official/on-record (a filed calculation, a confirmed business). */
  letterhead?: boolean;
}) {
  return (
    <div
      className={`rounded-md border border-line bg-surface p-6 shadow-card ${letterhead ? "letterhead" : ""} ${className}`}
    >
      {children}
    </div>
  );
}

export function SealMark({ children }: { children: React.ReactNode }) {
  return <span className="seal-mark">{children}</span>;
}

export function Eyebrow({ children }: { children: React.ReactNode }) {
  return <span className="text-sm font-medium text-ink-faint">{children}</span>;
}

export function ErrorNote({ children }: { children: React.ReactNode }) {
  if (!children) return null;
  return (
    <div className="rounded border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-danger">
      {children}
    </div>
  );
}

export function NavLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="text-sm text-ink-soft transition hover:text-ink">
      {children}
    </Link>
  );
}

export function TabBar<T extends string>({
  tabs,
  active,
  onChange,
  className = "",
}: {
  tabs: { id: T; label: string }[];
  active: T;
  onChange: (id: T) => void;
  className?: string;
}) {
  return (
    <div
      role="tablist"
      className={`inline-flex w-full gap-0.5 overflow-x-auto rounded-md border border-line bg-surface-2 p-1 sm:w-auto ${className}`}
    >
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          aria-selected={active === tab.id}
          onClick={() => onChange(tab.id)}
          className={`shrink-0 whitespace-nowrap rounded px-3 py-1.5 text-sm font-medium transition duration-150 ease-snap ${
            active === tab.id
              ? "bg-seal text-ink"
              : "text-ink-faint hover:bg-surface hover:text-ink-soft"
          }`}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}

/**
 * Generic dropdown menu primitive - closes on outside click, Escape, or any
 * click inside its panel (so DropdownItem links and action buttons both
 * close it automatically without each one needing its own handler).
 */
export function Dropdown({
  trigger,
  children,
  align = "left",
}: {
  trigger: (state: { open: boolean }) => ReactNode;
  children: ReactNode;
  align?: "left" | "right";
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div className="relative" ref={containerRef}>
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        {trigger({ open })}
      </button>
      {open && (
        <div
          onClick={() => setOpen(false)}
          className={`fade-in-up absolute z-50 mt-2 min-w-[14rem] overflow-hidden rounded-lg border border-line bg-surface py-1 shadow-card-raised ${
            align === "right" ? "right-0" : "left-0"
          }`}
        >
          {children}
        </div>
      )}
    </div>
  );
}

export function DropdownLabel({ children }: { children: ReactNode }) {
  return (
    <div className="truncate px-3 py-1.5 text-xs font-medium text-ink-faint">
      {children}
    </div>
  );
}

export function DropdownDivider() {
  return <div className="my-1 border-t border-line" />;
}

export function DropdownItem({
  href,
  onClick,
  active = false,
  danger = false,
  children,
}: {
  href?: string;
  onClick?: () => void;
  active?: boolean;
  danger?: boolean;
  children: ReactNode;
}) {
  const className = `block w-full truncate px-3 py-2 text-left text-sm transition duration-150 ${
    danger
      ? "text-danger hover:bg-danger-soft"
      : active
      ? "bg-usd-soft text-usd"
      : "text-ink-soft hover:bg-surface-2 hover:text-ink"
  }`;
  if (href) {
    return (
      <Link href={href} className={className}>
        {children}
      </Link>
    );
  }
  return (
    <button type="button" onClick={onClick} className={className}>
      {children}
    </button>
  );
}

export function ChevronDown({ open = false }: { open?: boolean }) {
  return (
    <svg
      viewBox="0 0 12 12"
      width="10"
      height="10"
      className={`shrink-0 transition-transform duration-150 ${open ? "rotate-180" : ""}`}
      fill="none"
    >
      <path d="M2.5 4.5 6 8l3.5-3.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function TrashIcon({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" fill="none" className={`shrink-0 ${className}`}>
      <path
        d="M3 4.5h10M6.4 4.5V3.2a1 1 0 0 1 1-1h1.2a1 1 0 0 1 1 1v1.3M4.6 4.5l.5 8.1a1 1 0 0 0 1 .9h3.8a1 1 0 0 0 1-.9l.5-8.1M6.7 7.2v3.6M9.3 7.2v3.6"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" fill="none">
      <path d="M3.5 3.5l9 9M12.5 3.5l-9 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

/**
 * Centered overlay dialog - closes on Escape, backdrop click, or the
 * close button. Content clicks are stopped from bubbling to the backdrop
 * so forms/buttons inside work normally.
 */
export function Modal({
  open,
  onClose,
  title,
  children,
  className = "",
}: {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  className?: string;
}) {
  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-[100] flex items-start justify-center overflow-y-auto bg-ink/50 px-4 py-10"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className={`fade-in-up letterhead w-full max-w-lg rounded-lg border border-line bg-surface p-6 shadow-card-raised ${className}`}
      >
        {title && (
          <div className="mb-4 flex items-center justify-between gap-4">
            <h2 className="font-display text-lg text-ink">{title}</h2>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="rounded-md p-1.5 text-ink-faint transition duration-150 hover:bg-surface-2 hover:text-ink"
            >
              <CloseIcon />
            </button>
          </div>
        )}
        {children}
      </div>
    </div>
  );
}

/** A small pill badge used on history rows ("Latest", "Viewing"). */
export function Badge({
  children,
  variant = "solid",
}: {
  children: ReactNode;
  variant?: "solid" | "outline";
}) {
  const className =
    variant === "solid"
      ? "rounded-full bg-seal px-2.5 py-0.5 text-xs font-medium text-ink"
      : "rounded-full border border-usd/60 px-2.5 py-0.5 text-xs font-medium text-usd";
  return <span className={className}>{children}</span>;
}

'@
$content = $content -replace "ELLIPSIS", [char]0x2026
[System.IO.File]::WriteAllText($fullPath, $content, (New-Object System.Text.UTF8Encoding($false)))
Write-Host "Wrote: $fullPath"


# ---- src/components/TopBar.tsx ----
$fullPath = (Get-ChildItem -LiteralPath $frontend -Recurse -Filter "TopBar.tsx" -File |
  Where-Object { $_.FullName -replace [regex]::Escape($frontend), "" -replace "\\","/" -match "src/components/TopBar.tsx$" } |
  Select-Object -First 1).FullName
if (-not $fullPath) { Write-Host "NOT FOUND: src/components/TopBar.tsx" -ForegroundColor Red; exit 1 }
$content = @'
"use client";

import { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/lib/auth-context";
import { useTheme, Theme } from "@/lib/theme-context";
import { api } from "@/lib/api";
import { Business } from "@/lib/types";
import { RateSettingsModal } from "@/components/RateSettingsModal";
import {
  ChevronDown,
  Dropdown,
  DropdownDivider,
  DropdownItem,
  DropdownLabel,
  Logo,
} from "@/components/ui";

function initials(email: string): string {
  const name = email.split("@")[0] ?? email;
  return name.slice(0, 2).toUpperCase();
}

function GearIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3.2" />
      <path d="M19.4 13.5c.1-.5.1-1 0-1.5l1.6-1.2-1.6-2.8-1.9.6a6.9 6.9 0 0 0-1.3-.75L15.8 5h-3.2l-.4 2.15c-.47.18-.9.43-1.3.75l-1.9-.6-1.6 2.8 1.6 1.2c-.1.5-.1 1 0 1.5l-1.6 1.2 1.6 2.8 1.9-.6c.4.32.83.57 1.3.75L12.6 19h3.2l.4-2.15c.47-.18.9-.43 1.3-.75l1.9.6 1.6-2.8-1.6-1.2Z" />
    </svg>
  );
}

function HelpIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" />
      <path d="M9.5 9a2.5 2.5 0 0 1 4.9.8c0 1.7-2.4 1.7-2.4 3.4" />
      <circle cx="12" cy="16.5" r="0.6" fill="currentColor" stroke="none" />
    </svg>
  );
}

function BookIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 5.5C4 4.7 4.7 4 5.5 4H12v16H5.5A1.5 1.5 0 0 1 4 18.5v-13Z" />
      <path d="M20 5.5c0-.8-.7-1.5-1.5-1.5H12v16h6.5a1.5 1.5 0 0 0 1.5-1.5v-13Z" />
    </svg>
  );
}

function RatesIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3v18" />
      <path d="M17 7.5c0-1.7-2-3-5-3s-5 1.3-5 3 2 2.3 5 2.7 5 1 5 2.8-2 3-5 3-5-1.3-5-3" />
    </svg>
  );
}

function SunIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="4.2" />
      <path d="M12 2.5v2.4M12 19.1v2.4M4.6 4.6l1.7 1.7M17.7 17.7l1.7 1.7M2.5 12h2.4M19.1 12h2.4M4.6 19.4l1.7-1.7M17.7 6.3l1.7-1.7" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a6.8 6.8 0 0 0 10.5 10.5Z" />
    </svg>
  );
}

function MonitorIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4.5" width="18" height="12" rx="1.5" />
      <path d="M8.5 20h7M12 16.5V20" />
    </svg>
  );
}

/** Appearance segmented control (Light / Dark / Auto) shown inside the account dropdown. */
function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const options: { value: Theme; label: string; icon: JSX.Element }[] = [
    { value: "light", label: "Light", icon: <SunIcon /> },
    { value: "dark", label: "Dark", icon: <MoonIcon /> },
    { value: "system", label: "Auto", icon: <MonitorIcon /> },
  ];
  return (
    <div className="px-3 py-2">
      <span className="mb-1.5 block text-xs font-medium text-ink-faint">
        Appearance
      </span>
      <div className="flex gap-1 rounded-md border border-line bg-paper/60 p-1">
        {options.map((opt) => (
          <button
            key={opt.value}
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setTheme(opt.value);
            }}
            className={`flex flex-1 items-center justify-center gap-1.5 rounded px-2 py-1.5 text-xs font-medium transition duration-150 ${
              theme === opt.value ? "bg-seal text-ink" : "text-ink-soft hover:text-ink"
            }`}
          >
            {opt.icon}
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function LegalIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3v18" />
      <path d="M5 7h14" />
      <path d="M5 7 2.5 12a2.5 2.5 0 0 0 5 0Z" />
      <path d="M19 7l-2.5 5a2.5 2.5 0 0 0 5 0Z" />
      <path d="M8 21h8" />
    </svg>
  );
}

function LegalSubmenu() {
  const [expanded, setExpanded] = useState(false);
  return (
    <div>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setExpanded((v) => !v);
        }}
        className="flex w-full items-center justify-between px-3 py-2 text-left text-sm text-ink-soft transition hover:bg-paper hover:text-ink"
      >
        <span className="flex items-center gap-2.5">
          <LegalIcon />
          Legal
        </span>
        <ChevronDown open={expanded} />
      </button>
      {expanded && (
        <div className="border-t border-line bg-paper/60 py-1">
          <DropdownItem href="/legal/disclaimer">
            <span className="pl-6">Disclaimer</span>
          </DropdownItem>
          <DropdownItem href="/legal/privacy-policy">
            <span className="pl-6">Privacy Policy</span>
          </DropdownItem>
          <DropdownItem href="/legal/terms-of-service">
            <span className="pl-6">Terms of Service</span>
          </DropdownItem>
        </div>
      )}
    </div>
  );
}

export function TopBar() {
  const { user, logout } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  const [businesses, setBusinesses] = useState<Business[] | null>(null);
  const [ratesOpen, setRatesOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api
      .listBusinesses()
      .then((data) => {
        if (!cancelled) setBusinesses(data);
      })
      .catch(() => {
        if (!cancelled) setBusinesses([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const currentBusinessId = pathname?.match(/^\/dashboard\/([^/]+)/)?.[1];
  const currentBusiness = businesses?.find((b) => b.id === currentBusinessId) ?? null;

  async function onLogout() {
    await logout();
    router.push("/login");
  }

  return (
    <header className="sticky top-0 z-40 border-x-0 border-t-0 border-b border-line bg-surface/95">
      <div className="h-[3px] bg-gradient-to-r from-seal via-[#E4C368] to-seal" />
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
        <div className="flex items-center gap-2">
          <Link href="/dashboard" className="mr-4">
            <Logo />
          </Link>

          <Dropdown
            align="left"
            trigger={({ open }) => (
              <span
                className={`flex items-center gap-1.5 rounded-md px-2 py-1.5 text-sm transition duration-150 ${
                  open ? "bg-paper/60 text-ink" : "text-ink-soft hover:text-usd"
                }`}
              >
                <span className="max-w-[10rem] truncate">
                  {currentBusiness ? currentBusiness.name : "Businesses"}
                </span>
                <ChevronDown open={open} />
              </span>
            )}
          >
            <DropdownLabel>Your businesses</DropdownLabel>
            {businesses === null && (
              <div className="px-3 py-2 text-xs text-ink-faint">Loading...</div>
            )}
            {businesses?.length === 0 && (
              <div className="px-3 py-2 text-xs text-ink-faint">
                No businesses yet - add one from the dashboard.
              </div>
            )}
            {businesses?.map((b) => (
              <DropdownItem key={b.id} href={`/dashboard/${b.id}`} active={b.id === currentBusinessId}>
                {b.name}
              </DropdownItem>
            ))}
            <DropdownDivider />
            <DropdownItem href="/dashboard">All businesses</DropdownItem>
          </Dropdown>
        </div>

        <Dropdown
          align="right"
          trigger={({ open }) => (
            <span
              className={`flex h-8 w-8 items-center justify-center rounded-full bg-seal font-mono text-xs font-semibold text-ink transition ${
                open ? "ring-2 ring-usd ring-offset-2 ring-offset-surface" : ""
              }`}
            >
              {user ? initials(user.email) : "?"}
            </span>
          )}
        >
          {user && <DropdownLabel>{user.email}</DropdownLabel>}
          <DropdownItem href="/account">
            <span className="flex items-center gap-2.5">
              <GearIcon />
              Account &amp; security
            </span>
          </DropdownItem>
          <DropdownItem href="/tutorial">
            <span className="flex items-center gap-2.5">
              <HelpIcon />
              How Twelve C works
            </span>
          </DropdownItem>
          <DropdownItem href="/learn">
            <span className="flex items-center gap-2.5">
              <BookIcon />
              Know your taxes
            </span>
          </DropdownItem>
          <DropdownItem onClick={() => setRatesOpen(true)}>
            <span className="flex items-center gap-2.5">
              <RatesIcon />
              Rate settings
            </span>
          </DropdownItem>
          <DropdownDivider />
          <ThemeToggle />
          <DropdownDivider />
          <LegalSubmenu />
          <DropdownDivider />
          <DropdownItem onClick={onLogout} danger>
            Log out
          </DropdownItem>
        </Dropdown>
      </div>

      <RateSettingsModal
        open={ratesOpen}
        onClose={() => setRatesOpen(false)}
        highlightBusinessId={currentBusinessId}
      />
    </header>
  );
}
'@
$content = $content -replace "ELLIPSIS", [char]0x2026
[System.IO.File]::WriteAllText($fullPath, $content, (New-Object System.Text.UTF8Encoding($false)))
Write-Host "Wrote: $fullPath"


# ---- src/components/OverdueDigest.tsx ----
$fullPath = (Get-ChildItem -LiteralPath $frontend -Recurse -Filter "OverdueDigest.tsx" -File |
  Where-Object { $_.FullName -replace [regex]::Escape($frontend), "" -replace "\\","/" -match "src/components/OverdueDigest.tsx$" } |
  Select-Object -First 1).FullName
if (-not $fullPath) { Write-Host "NOT FOUND: src/components/OverdueDigest.tsx" -ForegroundColor Red; exit 1 }
$content = @'
"use client";

import Link from "next/link";
import { money } from "@/lib/format";
import { Business, QpdCalculationOut } from "@/lib/types";

const QUARTER_DATES = [
  { month: 2, day: 25 },
  { month: 5, day: 25 },
  { month: 8, day: 25 },
  { month: 11, day: 20 },
];

function startOfDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export interface DigestItem {
  business: Business;
  latestCalc: QpdCalculationOut | null;
}

export function OverdueDigest({ items }: { items: DigestItem[] }) {
  const today = startOfDay(new Date());

  const flagged = items
    .map(({ business, latestCalc }) => {
      if (!latestCalc) return null;
      const schedule = latestCalc.result_json.schedule;
      let usdOwed = 0;
      let zigOwed = 0;
      let count = 0;
      schedule.forEach((inst, i) => {
        const { month, day } = QUARTER_DATES[i];
        const due = new Date(latestCalc.tax_year, month, day);
        const paid = inst.usd_balance <= 0.01 && inst.zig_balance <= 0.01;
        if (!paid && due < today) {
          usdOwed += inst.usd_balance;
          zigOwed += inst.zig_balance;
          count += 1;
        }
      });
      if (count === 0) return null;
      return { business, usdOwed, zigOwed, count };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  if (flagged.length === 0) return null;

  const totalUsd = flagged.reduce((s, f) => s + f.usdOwed, 0);
  const totalZig = flagged.reduce((s, f) => s + f.zigOwed, 0);
  const totalInstalments = flagged.reduce((s, f) => s + f.count, 0);
  const worst = [...flagged].sort((a, b) => b.usdOwed - a.usdOwed)[0];

  return (
    <div className="fade-in-up relative mb-8 overflow-hidden rounded-xl bg-ink p-7 text-paper shadow-hero sm:p-8">
      <div className="absolute inset-x-0 top-0 h-[3px] bg-gradient-to-r from-seal via-[#E4C368] to-seal" />

      <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-sm text-paper/70">Outstanding across your businesses</p>
          <div className="mt-2 flex flex-wrap items-baseline gap-4">
            <span className="font-display text-4xl leading-none sm:text-5xl">{money(totalUsd, "USD")}</span>
            <span className="font-mono text-lg text-paper/60">{money(totalZig, "ZIG")}</span>
          </div>
        </div>
        <span className="stamp-mark stamp-in shrink-0">
          {totalInstalments} {totalInstalments === 1 ? "instalment" : "instalments"} overdue
        </span>
      </div>

      <div className="mt-6 space-y-1 border-t border-paper/15 pt-5">
        {flagged.map((f) => (
          <Link
            key={f.business.id}
            href={`/dashboard/${f.business.id}`}
            className="flex items-center justify-between rounded-md px-2 py-2 text-sm text-paper/85 transition duration-150 hover:bg-paper/10"
          >
            <span>{f.business.name}</span>
            <span className="font-mono tabular-nums text-paper/70">
              {money(f.usdOwed, "USD")} / {money(f.zigOwed, "ZIG")}
            </span>
          </Link>
        ))}
      </div>

      <div className="mt-6 flex flex-wrap items-center justify-between gap-4 border-t border-paper/15 pt-5">
        <p className="max-w-[38ch] text-sm text-paper/70">
          {flagged.length === 1
            ? `${worst.business.name} is behind on ${worst.count === 1 ? "one instalment" : `${worst.count} instalments`}.`
            : `${flagged.length} businesses need attention, starting with ${worst.business.name}.`}
        </p>
        <Link
          href={`/dashboard/${worst.business.id}`}
          className="inline-flex items-center justify-center rounded-md bg-seal px-4 py-2.5 text-sm font-semibold text-[#2A1D06] transition duration-150 hover:bg-[#B68627]"
        >
          Review {worst.business.name}
        </Link>
      </div>
    </div>
  );
}

'@
$content = $content -replace "ELLIPSIS", [char]0x2026
[System.IO.File]::WriteAllText($fullPath, $content, (New-Object System.Text.UTF8Encoding($false)))
Write-Host "Wrote: $fullPath"


# ---- src/app/dashboard/page.tsx ----
$fullPath = (Get-ChildItem -LiteralPath $frontend -Recurse -Filter "page.tsx" -File |
  Where-Object { $_.FullName -replace [regex]::Escape($frontend), "" -replace "\\","/" -match "src/app/dashboard/page.tsx$" } |
  Select-Object -First 1).FullName
if (-not $fullPath) { Write-Host "NOT FOUND: src/app/dashboard/page.tsx" -ForegroundColor Red; exit 1 }
$content = @'
"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AuthGuard } from "@/components/AuthGuard";
import { TopBar } from "@/components/TopBar";
import { OverdueDigest, DigestItem } from "@/components/OverdueDigest";
import { Button, Card, ErrorNote, Eyebrow, Field, TrashIcon } from "@/components/ui";
import { api } from "@/lib/api";
import { Business, QpdCalculationOut } from "@/lib/types";
import { money } from "@/lib/format";

const QUARTER_DATES = [
  { month: 2, day: 25 }, // Q1 - 25 March
  { month: 5, day: 25 }, // Q2 - 25 June
  { month: 8, day: 25 }, // Q3 - 25 September
  { month: 11, day: 20 }, // Q4 - 20 December
];

function startOfDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

interface NextDueBadge {
  tone: "danger" | "warn" | "ok";
  label: string;
  amount: string | null;
}

// Compact version of the logic in NextPaymentDue/OverdueDigest, sized for a
// one-line status on each dashboard ledger row rather than a full panel.
function nextDueBadge(calc: QpdCalculationOut | null | undefined): NextDueBadge | null {
  if (!calc) return null;
  const today = startOfDay(new Date());
  const withDates = calc.result_json.schedule.map((inst, i) => {
    const { month, day } = QUARTER_DATES[i];
    return {
      ...inst,
      date: new Date(calc.tax_year, month, day),
      paid: inst.usd_balance <= 0.01 && inst.zig_balance <= 0.01,
    };
  });

  const overdue = withDates.filter((i) => !i.paid && i.date < today);
  if (overdue.length > 0) {
    const usdOwed = overdue.reduce((s, i) => s + i.usd_balance, 0);
    const zigOwed = overdue.reduce((s, i) => s + i.zig_balance, 0);
    return {
      tone: "danger",
      label: overdue.length === 1 ? "1 instalment overdue" : `${overdue.length} instalments overdue`,
      amount: `${money(usdOwed, "USD")} / ${money(zigOwed, "ZIG")}`,
    };
  }

  const upcoming = withDates
    .filter((i) => !i.paid && i.date >= today)
    .sort((a, b) => a.date.getTime() - b.date.getTime());
  if (upcoming.length > 0) {
    const next = upcoming[0];
    const days = Math.round((next.date.getTime() - today.getTime()) / 86400000);
    return {
      tone: days <= 14 ? "warn" : "ok",
      label: days === 0 ? "Due today" : `Due in ${days}d`,
      amount: `${money(next.usd_balance, "USD")} / ${money(next.zig_balance, "ZIG")}`,
    };
  }

  return { tone: "ok", label: "All instalments paid", amount: null };
}

const STATUS_DOT: Record<NextDueBadge["tone"], string> = {
  danger: "bg-danger",
  warn: "bg-zig",
  ok: "bg-usd",
};
const STATUS_TEXT: Record<NextDueBadge["tone"], string> = {
  danger: "text-danger font-medium",
  warn: "text-zig",
  ok: "text-usd",
};

function ChevronRight() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" className="shrink-0 text-ink-faint">
      <path d="M9 6l6 6-6 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function DashboardContent() {
  const [businesses, setBusinesses] = useState<Business[] | null>(null);
  const [digestItems, setDigestItems] = useState<DigestItem[]>([]);
  const [error, setError] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [rate, setRate] = useState("26.8");
  const [taxRate, setTaxRate] = useState("0.25");
  const [aidsLevy, setAidsLevy] = useState("0.03");
  const [submitting, setSubmitting] = useState(false);

  async function load() {
    try {
      const data = await api.listBusinesses();
      setBusinesses(data);

      const items = await Promise.all(
        data.map(async (business) => {
          try {
            const calcs = await api.listCalculations(business.id);
            return { business, latestCalc: calcs[0] ?? null };
          } catch {
            return { business, latestCalc: null };
          }
        })
      );
      setDigestItems(items);
    } catch {
      setError("Couldn't load your businesses. Is the API running?");
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function onDelete(id: string) {
    setDeletingId(id);
    setError("");
    try {
      await api.deleteBusiness(id);
      setBusinesses((prev) => prev?.filter((b) => b.id !== id) ?? null);
      setDigestItems((prev) => prev.filter((d) => d.business.id !== id));
      setConfirmingDeleteId(null);
    } catch {
      setError("Couldn't delete that business. Try again in a moment.");
    } finally {
      setDeletingId(null);
    }
  }

  const calcByBusiness = new Map(digestItems.map((d) => [d.business.id, d.latestCalc]));

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      await api.createBusiness({
        name,
        default_exchange_rate: parseFloat(rate),
        default_tax_rate: parseFloat(taxRate),
        default_aids_levy_rate: parseFloat(aidsLevy),
      });
      setName("");
      setShowForm(false);
      await load();
    } catch {
      setError("Couldn't create that business. Check the values and try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="min-h-screen bg-paper">
      <TopBar />
      <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6 sm:py-12">
        <OverdueDigest items={digestItems} />

        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="font-display text-3xl text-ink sm:text-4xl">Dashboard</h1>
            <p className="mt-1.5 text-sm text-ink-soft">Track and file every business&rsquo;s QPD in one place.</p>
          </div>
          <Button variant="primary" onClick={() => setShowForm((s) => !s)} className="w-full sm:w-auto">
            {showForm ? "Cancel" : "+ Add a business"}
          </Button>
        </div>

        <ErrorNote>{error}</ErrorNote>

        {showForm && (
          <Card className="mt-6" letterhead>
            <h2 className="font-display text-xl text-ink">New business</h2>
            <form className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2" onSubmit={onCreate}>
              <div className="sm:col-span-2">
                <Field label="Business name" required value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <Field
                label="Default exchange rate (ZiG per 1 USD)"
                type="number"
                step="0.01"
                required
                value={rate}
                onChange={(e) => setRate(e.target.value)}
              />
              <Field
                label="Corporate tax rate"
                type="number"
                step="0.01"
                required
                value={taxRate}
                onChange={(e) => setTaxRate(e.target.value)}
                hint="0.25 = 25%"
              />
              <Field
                label="AIDS levy rate"
                type="number"
                step="0.01"
                required
                value={aidsLevy}
                onChange={(e) => setAidsLevy(e.target.value)}
                hint="0.03 = 3% of tax payable"
              />
              <div className="sm:col-span-2">
                <Button type="submit" variant="primary" disabled={submitting} className="w-full sm:w-auto">
                  {submitting ? "CreatingELLIPSIS" : "Create business"}
                </Button>
              </div>
            </form>
          </Card>
        )}

        <div className="mt-8">
          <div className="mb-3 flex items-baseline justify-between">
            <h2 className="font-display text-xl text-ink">Your businesses</h2>
            {businesses && businesses.length > 0 && (
              <Eyebrow>{businesses.length === 1 ? "1 business" : `${businesses.length} businesses`}</Eyebrow>
            )}
          </div>

          {businesses === null && (
            <div className="overflow-hidden rounded-xl border border-line bg-surface shadow-card">
              {[0, 1, 2].map((i) => (
                <div key={i} className={`border-b border-line p-5 last:border-b-0 ${i > 0 ? "" : ""}`}>
                  <div className="h-4 w-40 animate-pulse rounded bg-paper" />
                  <div className="mt-3 h-3 w-24 animate-pulse rounded bg-paper" />
                </div>
              ))}
            </div>
          )}

          {businesses?.length === 0 && (
            <Card>
              <p className="text-sm text-ink-soft">
                No businesses yet. Add one above to run your first QPD calculation.
              </p>
            </Card>
          )}

          {businesses && businesses.length > 0 && (
            <div className="overflow-hidden rounded-xl border border-line bg-surface shadow-card-raised">
              <div className={`hidden grid-cols-[2.2fr_1.1fr_1.8fr_1.4fr_18px_26px] gap-4 px-6 py-3 text-xs font-medium text-ink-faint sm:grid`}>
                <span>Business</span>
                <span>Status</span>
                <span>Rate</span>
                <span className="text-right">Amount due</span>
                <span />
                <span />
              </div>

              {businesses.map((b, idx) => {
                const badge = nextDueBadge(calcByBusiness.get(b.id));
                const initials = b.name
                  .split(/\s+/)
                  .filter(Boolean)
                  .slice(0, 2)
                  .map((w) => w[0]?.toUpperCase())
                  .join("");
                const isConfirming = confirmingDeleteId === b.id;

                if (isConfirming) {
                  return (
                    <div
                      key={b.id}
                      className={`flex flex-wrap items-center justify-between gap-3 px-6 py-4 ${
                        idx > 0 ? "border-t border-line" : ""
                      }`}
                    >
                      <span className="text-sm text-danger">
                        {`Delete "${b.name}" and all its calculations? This can't be undone.`}
                      </span>
                      <div className="flex shrink-0 gap-2">
                        <button
                          onClick={() => onDelete(b.id)}
                          disabled={deletingId === b.id}
                          className="rounded-md bg-danger px-3 py-1.5 text-xs font-semibold text-paper transition disabled:opacity-50"
                        >
                          {deletingId === b.id ? "DeletingELLIPSIS" : "Yes, delete"}
                        </button>
                        <button
                          onClick={() => setConfirmingDeleteId(null)}
                          className="rounded-md border border-line px-3 py-1.5 text-xs text-ink-soft transition hover:text-ink"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  );
                }

                return (
                  <div key={b.id} className={`group transition duration-150 hover:bg-seal-soft ${idx > 0 ? "border-t border-line" : ""}`}>
                    {/* Mobile: stacked */}
                    <div className="flex flex-col gap-2 px-6 py-4 sm:hidden">
                      <div className="flex items-center justify-between gap-3">
                        <Link href={`/dashboard/${b.id}`} className="flex min-w-0 items-center gap-3">
                          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-seal font-mono text-xs font-semibold text-ink">
                            {initials || "?"}
                          </span>
                          <span className="truncate font-display text-base text-ink">{b.name}</span>
                        </Link>
                        <button
                          onClick={() => setConfirmingDeleteId(b.id)}
                          aria-label={`Delete ${b.name}`}
                          className="shrink-0 rounded-md p-1.5 text-ink-faint transition duration-150 hover:bg-danger-soft hover:text-danger"
                        >
                          <TrashIcon />
                        </button>
                      </div>
                      {badge && (
                        <Link href={`/dashboard/${b.id}`} className={`flex items-center gap-2 text-sm ${STATUS_TEXT[badge.tone]}`}>
                          <span className={`h-2 w-2 shrink-0 rounded-full ${STATUS_DOT[badge.tone]}`} />
                          {badge.label}
                        </Link>
                      )}
                      <Link
                        href={`/dashboard/${b.id}`}
                        className={`font-mono text-sm ${badge?.tone === "danger" ? "font-semibold text-danger" : "text-ink"}`}
                      >
                        {badge?.amount ?? <span className="text-ink-faint">No balance due</span>}
                      </Link>
                    </div>

                    {/* Desktop: ledger row */}
                    <div className="hidden grid-cols-[2.2fr_1.1fr_1.8fr_1.4fr_18px_26px] items-center gap-4 px-6 py-4 sm:grid">
                      <Link href={`/dashboard/${b.id}`} className="flex min-w-0 items-center gap-3">
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-seal font-mono text-xs font-semibold text-ink">
                          {initials || "?"}
                        </span>
                        <span className="truncate font-display text-base text-ink transition group-hover:text-usd">
                          {b.name}
                        </span>
                      </Link>

                      {badge ? (
                        <Link href={`/dashboard/${b.id}`} className={`flex items-center gap-2 text-sm ${STATUS_TEXT[badge.tone]}`}>
                          <span className={`h-2 w-2 shrink-0 rounded-full ${STATUS_DOT[badge.tone]}`} />
                          {badge.label}
                        </Link>
                      ) : (
                        <span />
                      )}

                      <Link href={`/dashboard/${b.id}`} className="text-sm text-ink-soft">
                        ZiG {b.default_exchange_rate}/USD, {(b.default_tax_rate * 100).toFixed(0)}% tax +{" "}
                        {(b.default_aids_levy_rate * 100).toFixed(0)}% AIDS levy
                      </Link>

                      <Link
                        href={`/dashboard/${b.id}`}
                        className={`text-right font-mono text-sm ${badge?.tone === "danger" ? "font-semibold text-danger" : "text-ink"}`}
                      >
                        {badge?.amount ?? <span className="text-ink-faint">No balance due</span>}
                      </Link>

                      <Link href={`/dashboard/${b.id}`}>
                        <ChevronRight />
                      </Link>

                      <button
                        onClick={() => setConfirmingDeleteId(b.id)}
                        aria-label={`Delete ${b.name}`}
                        className="justify-self-end rounded-md p-1.5 text-ink-faint opacity-0 transition duration-150 hover:bg-danger-soft hover:text-danger group-hover:opacity-100"
                      >
                        <TrashIcon />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </main>
  );
}

export default function DashboardPage() {
  return (
    <AuthGuard>
      <DashboardContent />
    </AuthGuard>
  );
}

'@
$content = $content -replace "ELLIPSIS", [char]0x2026
[System.IO.File]::WriteAllText($fullPath, $content, (New-Object System.Text.UTF8Encoding($false)))
Write-Host "Wrote: $fullPath"


Set-Location $repoRoot
git status
git add .
git commit -m "Dashboard redesign: ledger-row business list, stamped overdue hero, fix uppercase-mono label pattern app-wide"
git push
