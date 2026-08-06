import type { Metadata } from "next";
import { Fraunces, IBM_Plex_Sans, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";
import { AuthProvider } from "@/lib/auth-context";

const fraunces = Fraunces({
  subsets: ["latin"],
  variable: "--font-fraunces",
  axes: ["opsz", "SOFT", "WONK"],
  display: "swap",
});

const plexSans = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-plex-sans",
  display: "swap",
});

const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-plex-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Twelve C | ZIMRA provisional tax, calculated properly",
  description:
    "Calculate, file, and track your ZIMRA Quarterly Payment Date provisional tax across USD and ZIG in one place, named for the ITF12C form it replaces.",
  openGraph: {
    title: "Twelve C | ZIMRA provisional tax, calculated properly",
    description:
      "Calculate, file, and track your ZIMRA Quarterly Payment Date provisional tax across USD and ZIG in one place.",
    siteName: "Twelve C",
    locale: "en_ZW",
    type: "website",
  },
  twitter: {
    card: "summary",
    title: "Twelve C | ZIMRA provisional tax, calculated properly",
    description:
      "Calculate, file, and track your ZIMRA Quarterly Payment Date provisional tax across USD and ZIG in one place.",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${fraunces.variable} ${plexSans.variable} ${plexMono.variable}`}>
      <body className="font-body antialiased">
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
