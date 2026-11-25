"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/lib/auth-context";
import { useTheme, Theme } from "@/lib/theme-context";
import { api } from "@/lib/api";
import { Business } from "@/lib/types";
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

function LogoutIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 7V5.5A1.5 1.5 0 0 0 12.5 4h-6A1.5 1.5 0 0 0 5 5.5v13A1.5 1.5 0 0 0 6.5 20h6a1.5 1.5 0 0 0 1.5-1.5V17" />
      <path d="M9 12h11M17 8.5 20.5 12 17 15.5" />
    </svg>
  );
}

export function TopBar() {
  const { user, logout } = useAuth();
  const isStudyGuest = user?.is_study_guest === true;
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const activeBusinessView = searchParams.get("view");
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const headerRef = useRef<HTMLElement>(null);

  const [businesses, setBusinesses] = useState<Business[] | null>(null);

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
  const isNewCalculation = Boolean(pathname?.endsWith("/new"));
  const overviewHref = currentBusinessId ? `/dashboard/${currentBusinessId}` : "/dashboard";
  const reconciliationHref = currentBusinessId ? `/dashboard/${currentBusinessId}?view=reconciliation` : "/dashboard";
  const historyHref = currentBusinessId ? `/dashboard/${currentBusinessId}?view=history` : "/dashboard";

  async function onLogout() {
    const wasStudyGuest = user?.is_study_guest === true;
    await logout();
    router.push(wasStudyGuest ? "/" : "/login");
  }

  useEffect(() => {
    setMobileMenuOpen(false);
  }, [pathname, searchParams]);

  useEffect(() => {
    if (!mobileMenuOpen) return;
    function onPointerDown(event: PointerEvent) {
      if (!headerRef.current?.contains(event.target as Node)) setMobileMenuOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setMobileMenuOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [mobileMenuOpen]);

  return (
    <header ref={headerRef} className="sticky top-0 z-40 border-x-0 border-t-0 border-b border-line bg-surface/95 backdrop-blur">
      <div className="h-[3px] bg-gradient-to-r from-seal via-[#9EC494] to-seal" />
      <div className="mx-auto max-w-7xl px-4 sm:px-6">
        <div className="flex min-h-16 items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <Link href="/dashboard" aria-label="Twelve C dashboard" className="shrink-0">
              <Logo />
            </Link>
            <div className="hidden min-w-0 sm:block">
              <Dropdown align="left" ariaLabel="Switch business" trigger={({ open }) => (
                  <span className={`flex max-w-[15rem] items-center gap-1.5 rounded-md px-2 py-1.5 text-sm transition duration-150 ${
                    open ? "bg-paper/60 text-ink" : "text-ink-soft hover:text-usd"
                  }`}>
                    <span className="max-w-[11rem] truncate">
                      {currentBusiness ? currentBusiness.name : "Businesses"}
                    </span>
                    <ChevronDown open={open} />
                  </span>
                )}>
                <DropdownLabel>Your businesses</DropdownLabel>
                {businesses === null && (
                  <div className="px-3 py-2 text-xs text-ink-faint">Loading businesses…</div>
                )}
                {businesses?.length === 0 && (
                  <div className="px-3 py-2 text-xs text-ink-faint">
                    No businesses yet. Add one from the dashboard.
                  </div>
                )}
                {businesses?.map((business) => (
                  <DropdownItem
                    key={business.id}
                    href={`/dashboard/${business.id}`}
                    active={business.id === currentBusinessId}
                  >
                    {business.name}
                  </DropdownItem>
                ))}
                <DropdownDivider />
                <DropdownItem href="/dashboard">All businesses</DropdownItem>
              </Dropdown>
            </div>
          </div>

          <nav aria-label="Primary navigation" className="hidden items-center gap-1 lg:flex">
            <Link
              href="/dashboard"
              aria-current={pathname === "/dashboard" ? "page" : undefined}
              className={`rounded-md px-3 py-2 text-sm font-medium transition ${
                pathname === "/dashboard" ? "bg-seal-soft text-ink" : "text-ink-soft hover:bg-paper hover:text-ink"
              }`}
            >
              Dashboard
            </Link>
            {currentBusinessId && (
              <>
                {isNewCalculation ? (
                  <Link
                    href={overviewHref}
                    className="rounded-md px-3 py-2 text-sm font-medium text-ink-soft transition hover:bg-paper hover:text-ink"
                  >
                    Business overview
                  </Link>
                ) : (
                  <>
                    <Link
                      href={overviewHref}
                      aria-current={!activeBusinessView || activeBusinessView === "overview" ? "page" : undefined}
                      className={`rounded-md px-3 py-2 text-sm font-medium transition ${
                        !activeBusinessView || activeBusinessView === "overview"
                          ? "bg-seal-soft text-ink"
                          : "text-ink-soft hover:bg-paper hover:text-ink"
                      }`}
                    >
                      Overview
                    </Link>
                    <Link
                      href={reconciliationHref}
                      aria-current={activeBusinessView === "reconciliation" ? "page" : undefined}
                      className={`rounded-md px-3 py-2 text-sm font-medium transition ${
                        activeBusinessView === "reconciliation"
                          ? "bg-seal-soft text-ink"
                          : "text-ink-soft hover:bg-paper hover:text-ink"
                      }`}
                    >
                      Reconciliation
                    </Link>
                    <Link
                      href={historyHref}
                      aria-current={activeBusinessView === "history" ? "page" : undefined}
                      className={`rounded-md px-3 py-2 text-sm font-medium transition ${
                        activeBusinessView === "history"
                          ? "bg-seal-soft text-ink"
                          : "text-ink-soft hover:bg-paper hover:text-ink"
                      }`}
                    >
                      History
                    </Link>
                  </>
                )}
              </>
            )}
            <span className="mx-1 h-5 w-px bg-line" />
            <Link href="/tutorial" className="rounded-md px-3 py-2 text-sm text-ink-soft transition hover:bg-paper hover:text-ink">
              How it works
            </Link>
            <Link href="/learn" className="rounded-md px-3 py-2 text-sm text-ink-soft transition hover:bg-paper hover:text-ink">
              Tax guide
            </Link>
          </nav>

          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              aria-label={mobileMenuOpen ? "Close main navigation" : "Open main navigation"}
              aria-expanded={mobileMenuOpen}
              aria-controls="mobile-app-navigation"
              onClick={() => setMobileMenuOpen((open) => !open)}
              className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-line text-ink-soft transition hover:bg-paper hover:text-ink lg:hidden"
            >
              {mobileMenuOpen ? (
                <svg viewBox="0 0 24 24" width="19" height="19" fill="none" aria-hidden="true">
                  <path d="m6 6 12 12M18 6 6 18" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" width="19" height="19" fill="none" aria-hidden="true">
                  <path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                </svg>
              )}
            </button>
            <Dropdown align="right" ariaLabel="Account and preferences" trigger={() => (
                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-seal font-mono text-xs font-semibold text-ink">
                  {isStudyGuest ? "ST" : user ? initials(user.email) : "?"}
                </span>
              )}>
              {user && (
                <div className="mb-1 flex items-center gap-3 bg-paper/50 px-3.5 py-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-seal font-mono text-xs font-semibold text-ink">
                    {isStudyGuest ? "ST" : initials(user.email)}
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-ink">
                      {isStudyGuest ? "Anonymous research session" : user.email}
                    </p>
                    <p className="text-xs text-ink-faint">
                      {isStudyGuest ? "Entries saved to the Twelve C API" : "Signed in"}
                    </p>
                  </div>
                </div>
              )}
              {!isStudyGuest && (
                <DropdownItem href="/account">
                  <span className="flex items-center gap-2.5">
                    <GearIcon />
                    Account &amp; security
                  </span>
                </DropdownItem>
              )}
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
              <ThemeToggle />
              <DropdownDivider />
              <LegalSubmenu />
              <DropdownDivider />
              <DropdownItem onClick={onLogout} danger>
                <span className="flex items-center gap-2.5">
                  <LogoutIcon />
                  {isStudyGuest ? "End research session" : "Log out"}
                </span>
              </DropdownItem>
            </Dropdown>
          </div>
        </div>
      </div>

      {mobileMenuOpen && (
        <nav id="mobile-app-navigation" aria-label="Mobile main navigation" className="border-t border-line bg-surface px-4 py-3 shadow-card lg:hidden">
          <div className="mx-auto flex max-w-7xl flex-col gap-1">
            <Link
              href="/dashboard"
              onClick={() => setMobileMenuOpen(false)}
              aria-current={pathname === "/dashboard" ? "page" : undefined}
              className="rounded-md px-3 py-2.5 text-sm font-medium text-ink-soft transition hover:bg-paper hover:text-ink"
            >
              All businesses
            </Link>
            {currentBusinessId && (
              <>
                <p className="px-3 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-faint">
                  {currentBusiness?.name ?? "Current business"}
                </p>
                <Link
                  href={overviewHref}
                  onClick={() => setMobileMenuOpen(false)}
                  aria-current={!activeBusinessView || activeBusinessView === "overview" ? "page" : undefined}
                  className={`rounded-md px-3 py-2.5 text-sm transition ${
                    !activeBusinessView || activeBusinessView === "overview"
                      ? "bg-seal-soft font-medium text-ink"
                      : "text-ink-soft hover:bg-paper hover:text-ink"
                  }`}
                >
                  Overview
                </Link>
                <Link
                  href={reconciliationHref}
                  onClick={() => setMobileMenuOpen(false)}
                  aria-current={activeBusinessView === "reconciliation" ? "page" : undefined}
                  className={`rounded-md px-3 py-2.5 text-sm transition ${
                    activeBusinessView === "reconciliation"
                      ? "bg-seal-soft font-medium text-ink"
                      : "text-ink-soft hover:bg-paper hover:text-ink"
                  }`}
                >
                  Reconciliation
                </Link>
                <Link
                  href={historyHref}
                  onClick={() => setMobileMenuOpen(false)}
                  aria-current={activeBusinessView === "history" ? "page" : undefined}
                  className={`rounded-md px-3 py-2.5 text-sm transition ${
                    activeBusinessView === "history"
                      ? "bg-seal-soft font-medium text-ink"
                      : "text-ink-soft hover:bg-paper hover:text-ink"
                  }`}
                >
                  History
                </Link>
                {isNewCalculation && (
                  <span className="rounded-md bg-seal-soft px-3 py-2.5 text-sm font-medium text-ink">
                    New QPD calculation
                  </span>
                )}
              </>
            )}
            <div className="my-2 border-t border-line" />
            <p className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-faint">
              Your businesses
            </p>
            {businesses === null && <p className="px-3 py-2 text-xs text-ink-faint">Loading businesses…</p>}
            {businesses?.length === 0 && <p className="px-3 py-2 text-xs text-ink-faint">No businesses yet.</p>}
            {businesses?.filter((business) => business.id !== currentBusinessId).map((business) => (
              <Link
                key={business.id}
                href={`/dashboard/${business.id}`}
                onClick={() => setMobileMenuOpen(false)}
                className="truncate rounded-md px-3 py-2.5 text-sm text-ink-soft transition hover:bg-paper hover:text-ink"
              >
                {business.name}
              </Link>
            ))}
            {businesses && businesses.filter((business) => business.id !== currentBusinessId).length === 0 && (
              <p className="px-3 py-2 text-xs text-ink-faint">No other businesses.</p>
            )}
            <div className="my-2 border-t border-line" />
            <p className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-faint">
              Resources
            </p>
            <Link href="/tutorial" onClick={() => setMobileMenuOpen(false)} className="rounded-md px-3 py-2.5 text-sm text-ink-soft transition hover:bg-paper hover:text-ink">
              How Twelve C works
            </Link>
            <Link href="/learn" onClick={() => setMobileMenuOpen(false)} className="rounded-md px-3 py-2.5 text-sm text-ink-soft transition hover:bg-paper hover:text-ink">
              Know your taxes
            </Link>
            {!isStudyGuest && (
              <Link href="/account" onClick={() => setMobileMenuOpen(false)} className="rounded-md px-3 py-2.5 text-sm text-ink-soft transition hover:bg-paper hover:text-ink">
                Account &amp; security
              </Link>
            )}
          </div>
        </nav>
      )}

      {isStudyGuest && (
        <div className="border-t border-line bg-seal-soft px-4 py-2.5 sm:px-6">
          <div className="mx-auto max-w-7xl text-xs leading-relaxed text-ink-soft">
            <span className="font-semibold text-ink">Research study session.</span>{" "}
            No account is required. Entries you make in Twelve C are saved through the API.
            Use only the fictional study data supplied by the researcher.
          </div>
        </div>
      )}
    </header>
  );
}
