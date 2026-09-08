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
