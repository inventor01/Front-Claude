import type { Metadata } from "next";
import PumpPortalListenerService from "./pumpportal-listener-service";
import "./globals.css";

export const metadata: Metadata = {
  title: "Front — Narrative Desk",
  description: "Discover public narratives, research related Solana coins, and measure paper trades.",
  other: {
    "codex-preview": "development",
  },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body className="antialiased">
        <PumpPortalListenerService />
        {children}
      </body>
    </html>
  );
}
