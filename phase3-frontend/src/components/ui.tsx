"use client";

import Link from "next/link";
import { InputHTMLAttributes, ButtonHTMLAttributes, ReactNode, useEffect, useRef, useState } from "react";

export function Logo({ className = "" }: { className?: string }) {
  return (
    <span className={`font-display text-xl tracking-tight text-ink ${className}`}>
      Twelve<span className="text-usd">C</span>
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
  /** For currency-style number fields: show a blank box with a "0.00" placeholder
   *  instead of a literal "0" sitting in the field. Purely cosmetic - the bound
   *  value is still 0 underneath, so calculations are unaffected. */
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
        className={`w-full rounded border border-line bg-surface px-3 py-2 font-mono text-sm text-ink outline-none transition focus:border-usd placeholder:text-ink-faint/50 ${props.className ?? ""}`}
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
  const base = "inline-flex items-center justify-center rounded px-4 py-2 text-sm font-semibold transition disabled:opacity-50 disabled:cursor-not-allowed";
  const variants: Record<string, string> = {
    primary: "bg-ink text-paper hover:bg-usd",
    secondary: "border border-ink text-ink hover:bg-ink hover:text-paper",
    ghost: "text-ink-soft hover:text-ink",
  };
  return <button {...props} className={`${base} ${variants[variant]} ${className}`} />;
}

export function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-md border border-line bg-surface p-6 shadow-card ${className}`}>
      {children}
    </div>
  );
}

export function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <span className="font-mono text-xs uppercase tracking-[0.15em] text-ink-faint">
      {children}
    </span>
  );
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
          className={`absolute z-50 mt-2 min-w-[14rem] overflow-hidden rounded-md border border-line bg-surface py-1 shadow-card ${
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
    <div className="truncate px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.12em] text-ink-faint">
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
  const className = `block w-full truncate px-3 py-2 text-left text-sm transition ${
    danger
      ? "text-danger hover:bg-danger-soft"
      : active
      ? "bg-usd-soft text-usd"
      : "text-ink-soft hover:bg-paper hover:text-ink"
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
