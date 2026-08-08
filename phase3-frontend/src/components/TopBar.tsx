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

export function TopBar() {
  const { user, logout } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  // Loaded once per TopBar mount - lightweight, and every page it renders on
  // is already behind AuthGuard, so the user is always authenticated here.
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
          <DropdownItem href="/account">Account &amp; security</DropdownItem>
          <DropdownDivider />
          <DropdownItem onClick={onLogout} danger>
            Log out
          </DropdownItem>
        </Dropdown>
      </div>
    </header>
  );
}
