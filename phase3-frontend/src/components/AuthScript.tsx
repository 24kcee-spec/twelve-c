"use client";

import Script from "next/script";
import { usePathname } from "next/navigation";

/**
 * Load Google Identity Services only where account sign-in is available.
 * The anonymous research route does not need or request this third-party script.
 */
export function AuthScript() {
  const pathname = usePathname();
  if (pathname === "/study" || pathname.startsWith("/study/")) return null;

  return <Script src="https://accounts.google.com/gsi/client" strategy="afterInteractive" />;
}
