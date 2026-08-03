"use client";

import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { Logo, NavLink } from "@/components/ui";

export function TopBar() {
  const { user, logout } = useAuth();
  const router = useRouter();

  async function onLogout() {
    await logout();
    router.push("/login");
  }

  return (
    <header className="border-b border-line bg-surface">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
        <a href="/dashboard">
          <Logo />
        </a>
        <nav className="flex items-center gap-6">
          <NavLink href="/dashboard">Businesses</NavLink>
          <NavLink href="/account">Account</NavLink>
          {user && <span className="text-sm text-ink-faint">{user.email}</span>}
          <button onClick={onLogout} className="text-sm text-ink-soft hover:text-danger">
            Log out
          </button>
        </nav>
      </div>
    </header>
  );
}
