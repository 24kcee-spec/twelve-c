"use client";

import { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/lib/auth-context";
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
    <header className="border-b border-line bg-surface">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
        <div className="flex items-center gap-2">
          <Link href="/dashboard" className="mr-4">
            <Logo />
          </Link>

          <Dropdown
            align="left"
            trigger={({ open }) => (
              <span
                className={`flex items-center gap-1.5 rounded px-2 py-1.5 text-sm transition ${
                  open ? "bg-paper text-ink" : "text-ink-soft hover:text-ink"
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
              className={`flex h-8 w-8 items-center justify-center rounded-full bg-ink font-mono text-xs font-semibold text-paper transition ${
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
          <DropdownDivider />
          <LegalSubmenu />
          <DropdownDivider />
          <DropdownItem onClick={onLogout} danger>
            Log out
          </DropdownItem>
        </Dropdown>
      </div>
    </header>
  );
}