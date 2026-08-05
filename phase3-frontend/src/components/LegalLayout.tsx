import Link from "next/link";
import { Logo } from "@/components/ui";

export function LegalLayout({
  title,
  lastUpdated,
  children,
}: {
  title: string;
  lastUpdated: string;
  children: React.ReactNode;
}) {
  return (
    <main className="min-h-screen bg-paper">
      <header className="mx-auto flex max-w-3xl items-center justify-between px-6 py-6">
        <Link href="/">
          <Logo />
        </Link>
        <Link href="/" className="text-sm text-ink-soft hover:text-ink">
          Back to home
        </Link>
      </header>

      <div className="mx-auto max-w-3xl px-6 pb-24">
        <h1 className="font-display text-3xl text-ink">{title}</h1>
        <p className="mt-2 font-mono text-xs uppercase tracking-[0.15em] text-ink-faint">
          Last updated: {lastUpdated}
        </p>
        <div className="mt-10 space-y-8">{children}</div>
      </div>
    </main>
  );
}

export function LSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="border-t border-line pt-6">
      <h2 className="font-display text-lg text-ink">{title}</h2>
      <div className="mt-3 space-y-3 text-sm leading-relaxed text-ink-soft">
        {children}
      </div>
    </section>
  );
}

export function LList({ items }: { items: React.ReactNode[] }) {
  return (
    <ul className="list-disc space-y-1.5 pl-5 text-sm leading-relaxed text-ink-soft">
      {items.map((item, i) => (
        <li key={i}>{item}</li>
      ))}
    </ul>
  );
}
