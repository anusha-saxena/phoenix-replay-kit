import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "Phoenix Replay Studio — Deterministic Strategy Regression Testing",
  description:
    "Explore reproducible strategy replay and decision comparisons using historical Phoenix perpetuals market data and the Ellipsis Labs Rise SDK.",
  openGraph: {
    title: "Phoenix Replay Studio",
    description:
      "Deterministic strategy regression testing on historical Phoenix market data.",
    type: "website",
  },
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
