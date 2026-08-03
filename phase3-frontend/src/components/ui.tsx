"use client";

import Link from "next/link";
import { InputHTMLAttributes, ButtonHTMLAttributes } from "react";

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
  ...props
}: { label: string; hint?: string } & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-ink-soft">{label}</span>
      <input
        {...props}
        className={`w-full rounded border border-line bg-surface px-3 py-2 font-mono text-sm text-ink outline-none transition focus:border-usd ${props.className ?? ""}`}
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
