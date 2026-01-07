import type { Metadata } from "next";
import Script from "next/script";
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
      <body>
        <Script
          src="https://unpkg.com/react-scan/dist/auto.global.js"
          strategy="beforeInteractive"
        />
        <Script
          src={`/caliper.js?v=${Date.now()}`}
          strategy="beforeInteractive"
          crossOrigin="anonymous"
        />
        {children}
      </body>
    </html>
  );
}
