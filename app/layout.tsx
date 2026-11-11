import "./globals.css";
export const metadata = {
  title: "StreetCode NYC | Live subway companion",
  description:
    "Explore the NYC subway map, choose your stations, find connections from live MTA predictions, and check arrivals and service alerts.",
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
