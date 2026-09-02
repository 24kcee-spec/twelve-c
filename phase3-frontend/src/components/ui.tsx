"use client";

import { LogoMark } from "@/components/LogoMark";
import Link from "next/link";
import { InputHTMLAttributes, ButtonHTMLAttributes, ReactNode, useEffect, useRef, useState } from "react";

export function Logo({ className = "" }: { className?: string }) {
  return (
    <span className={`flex items-center gap-2 font-display text-xl tracking-tight text-ink ${className}`}>
      <LogoMark size={22} />
      Twelve<span className="bg-signal-gradient bg-clip-text text-transparent">C</span>
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
      <span className="mb-1.5 block text-sm font-medium text-ink-soft">{label}</span>
      <input
        {...props}
        value={displayValue}
        placeholder={emptyIfZero ? "0.00" : placeholder}
        className={`w-full rounded-md border border-line bg-surface/60 px-3 py-2.5 font-mono text-sm text-ink outline-none backdrop-blur-sm transition duration-150 ease-snap focus:border-usd focus:shadow-glow-sm placeholder:text-ink-faint/50 ${props.className ?? ""}`}
      />
      {hint && <span className="mt-1.5 block text-xs text-ink-faint">{hint}</span>}
    </label>
  );
}

export function Button({
  variant = "primary",
  className = "",
  ...props
}: { variant?: "primary" | "secondary" | "ghost" } & ButtonHTMLAttributes<HTMLButtonElement>) {
  const base =
    "relative inline-flex items-center justify-center rounded-md px-4 py-2 text-sm font-semibold tracking-wide transition duration-150 ease-snap disabled:opacity-50 disabled:cursor-not-allowed";
  const variants: Record<string, string> = {
    primary:
      "bg-signal-gradient text-paper shadow-glow-sm hover:shadow-glow-usd hover:-translate-y-px active:translate-y-0",
    secondary:
      "border border-line bg-surface/50 text-ink backdrop-blur-sm hover:border-usd hover:text-usd hover:shadow-glow-sm",
    ghost: "text-ink-soft hover:text-usd",
  };
  return <button {...props} className={`${base} ${variants[variant]} ${className}`} />;
}

export function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`glass fade-in-up rounded-lg p-6 ${className}`}>
      {children}
    </div>
  );
}

export function Eyebrow({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 font-mono text-xs uppercase tracking-[0.2em] text-ink-faint ${className}`}>
      <span className="h-1 w-1 rounded-full bg-usd shadow-glow-sm" />
      {children}
    </span>
  );
}

export function ErrorNote({ children }: { children: React.ReactNode }) {
  if (!children) return null;
  return (
    <div className="rounded-md border border-danger/30 bg-danger-soft/70 px-3 py-2 text-sm text-danger backdrop-blur-sm">
      {children}
    </div>
  );
}

export function NavLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="text-sm text-ink-soft transition duration-150 hover:text-usd">
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
          className={`glass fade-in-up absolute z-50 mt-2 min-w-[14rem] overflow-hidden rounded-lg py-1 ${
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
  const className = `block w-full truncate px-3 py-2 text-left text-sm transition duration-150 ${
    danger
      ? "text-danger hover:bg-danger-soft"
      : active
      ? "bg-usd-soft text-usd"
      : "text-ink-soft hover:bg-paper/60 hover:text-ink"
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
      className="fixed inset-0 z-[100] flex items-start justify-center overflow-y-auto bg-ink/50 px-4 py-10 backdrop-blur-md"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className={`glass fade-in-up w-full max-w-lg rounded-lg p-6 ${className}`}
      >
        {title && (
          <div className="mb-4 flex items-center justify-between gap-4">
            <h2 className="font-display text-lg text-ink">{title}</h2>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="rounded-md p-1.5 text-ink-faint transition duration-150 hover:bg-paper/60 hover:text-ink"
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
      ? "rounded-full bg-signal-gradient px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide text-paper shadow-glow-sm"
      : "rounded-full border border-usd/60 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide text-usd";
  return <span className={className}>{children}</span>;
}
