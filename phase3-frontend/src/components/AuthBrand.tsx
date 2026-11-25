import Link from "next/link";
import { Logo } from "@/components/ui";

export function AuthBrand() {
  return (
    <Link
      href="/"
      aria-label="Twelve C home"
      className="inline-flex rounded-md transition-opacity hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-usd focus-visible:ring-offset-4"
    >
      <Logo />
    </Link>
  );
}
