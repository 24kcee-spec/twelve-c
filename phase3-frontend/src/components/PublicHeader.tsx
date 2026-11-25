"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Logo } from "@/components/ui";

const LINKS = [
  { href: "/tutorial", label: "How it works" },
  { href: "/learn", label: "Know your taxes" },
];

const LEGAL_LINKS = [
  { href: "/legal/disclaimer", label: "Disclaimer" },
  { href: "/legal/privacy-policy", label: "Privacy" },
  { href: "/legal/terms-of-service", label: "Terms" },
];

function linkClass(active: boolean) {
  return `rounded-md px-3 py-2 text-sm font-medium transition-colors duration-150 ${
    active ? "bg-seal-soft text-ink" : "text-ink-soft hover:bg-paper hover:text-ink"
  }`;
}

function MenuIcon({ open }: { open: boolean }) {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" aria-hidden="true">
      {open ? (
        <path d="m6 6 12 12M18 6 6 18" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      ) : (
        <path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      )}
    </svg>
  );
}

/**
 * Shared navigation for public pages. The desktop links and mobile menu
 * expose the same destinations so the documentation and legal pages never
 * become dead ends on smaller screens.
 */
export function PublicHeader() {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const headerRef = useRef<HTMLElement>(null);

  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!menuOpen) return;
    function onPointerDown(event: PointerEvent) {
      if (!headerRef.current?.contains(event.target as Node)) setMenuOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setMenuOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [menuOpen]);

  const isActive = (href: string) =>
    pathname === href || (href !== "/" && Boolean(pathname?.startsWith(`${href}/`)));

  return (
    <header ref={headerRef} className="sticky top-0 z-40 border-b border-line bg-surface/95 backdrop-blur">
      <div className="mx-auto flex min-h-16 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6">
        <Link href="/" aria-label="Twelve C home" className="shrink-0">
          <Logo />
        </Link>

        <nav aria-label="Main navigation" className="hidden items-center gap-1 lg:flex">
          {LINKS.map((item) => (
            <Link key={item.href} href={item.href} aria-current={isActive(item.href) ? "page" : undefined} className={linkClass(isActive(item.href))}>
              {item.label}
            </Link>
          ))}
          <div className="ml-2 h-5 w-px bg-line" />
          {LEGAL_LINKS.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              aria-current={isActive(item.href) ? "page" : undefined}
              className={linkClass(isActive(item.href))}
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="hidden shrink-0 items-center gap-2 lg:flex">
          <Link
            href="/study"
            className="rounded-md px-3 py-2 text-sm font-semibold text-usd transition hover:bg-usd-soft hover:text-ink"
          >
            Try without an account
          </Link>
          <Link
            href="/login"
            className="rounded-md px-3 py-2 text-sm font-medium text-ink-soft transition hover:bg-paper hover:text-ink"
          >
            Log in
          </Link>
          <Link
            href="/register"
            className="rounded-md bg-ink px-3.5 py-2 text-sm font-semibold text-paper transition hover:bg-seal hover:text-ink"
          >
            Get started
          </Link>
        </div>

        <button
          type="button"
          aria-label={menuOpen ? "Close navigation menu" : "Open navigation menu"}
          aria-expanded={menuOpen}
          aria-controls="public-mobile-navigation"
          onClick={() => setMenuOpen((open) => !open)}
          className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-line text-ink transition hover:bg-paper lg:hidden"
        >
          <MenuIcon open={menuOpen} />
        </button>
      </div>

      {menuOpen && (
        <nav
          id="public-mobile-navigation"
          aria-label="Mobile navigation"
          className="border-t border-line bg-surface px-4 py-3 shadow-card lg:hidden"
        >
          <div className="mx-auto flex max-w-7xl flex-col gap-1">
            {LINKS.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setMenuOpen(false)}
                aria-current={isActive(item.href) ? "page" : undefined}
                className={linkClass(isActive(item.href))}
              >
                {item.label}
              </Link>
            ))}
            <div className="my-2 border-t border-line" />
            <p className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-faint">
              Legal
            </p>
            {LEGAL_LINKS.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setMenuOpen(false)}
                aria-current={isActive(item.href) ? "page" : undefined}
                className={linkClass(isActive(item.href))}
              >
                {item.label}
              </Link>
            ))}
            <div className="my-2 border-t border-line" />
            <Link
              href="/study"
              onClick={() => setMenuOpen(false)}
              className="rounded-md px-3 py-2 text-sm font-semibold text-usd transition hover:bg-usd-soft"
            >
              Try without an account
            </Link>
            <Link
              href="/login"
              onClick={() => setMenuOpen(false)}
              className="rounded-md px-3 py-2 text-sm font-medium text-ink-soft transition hover:bg-paper hover:text-ink"
            >
              Log in
            </Link>
            <Link
              href="/register"
              onClick={() => setMenuOpen(false)}
              className="rounded-md bg-ink px-3 py-2.5 text-center text-sm font-semibold text-paper transition hover:bg-seal hover:text-ink"
            >
              Get started
            </Link>
          </div>
        </nav>
      )}
    </header>
  );
}
