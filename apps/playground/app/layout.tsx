import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "CALIPER Playground",
  description: "Visual sandbox for testing measurement behavior",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

