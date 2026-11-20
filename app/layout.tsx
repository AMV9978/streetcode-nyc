import "./globals.css";
import type { Metadata, Viewport } from "next";

const SITE = "https://streetcodenyc.angelovasquez.net";
const description =
  "Live NYC subway arrivals, an elevator-aware trip planner built on MTA predictions, and BFS, Dijkstra and A* running on the live subway.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE),
  title: "StreetCode NYC | Live subway companion",
  description,
  applicationName: "StreetCode NYC",
  manifest: "/manifest.webmanifest",
  openGraph: {
    type: "website",
    url: SITE,
    siteName: "StreetCode NYC",
    title: "StreetCode NYC | Live subway companion",
    description,
    images: [{ url: "/og.png", width: 1200, height: 630, alt: "StreetCode NYC" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "StreetCode NYC | Live subway companion",
    description,
    images: ["/og.png"],
  },
  icons: { apple: "/icon-192.png" },
};
export const viewport: Viewport = {
  themeColor: "#080e18",
  colorScheme: "dark",
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
