import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AFTERSHOCK — Follow the failure.",
  description:
    "Graph-backed incident investigation, persistent agent handoffs, and verifiable sandbox actions powered by FalkorDB.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
