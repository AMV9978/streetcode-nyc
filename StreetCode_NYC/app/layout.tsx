import "./globals.css";
export const metadata = {
  title: "StreetCode NYC | Live subway companion",
  description:
    "Live MTA arrivals, service alerts, station search and an explainable routing lab.",
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
