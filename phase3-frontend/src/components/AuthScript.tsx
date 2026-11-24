"use client";

import Script from "next/script";
import { usePathname } from "next/navigation";
import { useAuth } from "@/lib/auth-context";

/**
 * Load Google Identity Services only for visitors using account sign-in.
 * Anonymous research participants use the same app surfaces without account
 * identity providers or sign-in scripts.
 */
export function AuthScript() {
  const pathname = usePathname();
  const { user } = useAuth();

  if (
    pathname === "/study" ||
    pathname?.startsWith("/study/") ||
    user?.is_study_guest
  ) {
    return null;
  }

  return <Script src="https://accounts.google.com/gsi/client" strategy="afterInteractive" />;
}
