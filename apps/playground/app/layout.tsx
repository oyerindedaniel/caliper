import type { Metadata } from "next";
import Script from "next/script";
import { CaliperLoader } from "./components/caliper-loader";
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
        {process.env.NODE_ENV === "development" ? (
          <CaliperLoader />
        ) : (
          <Script src="" strategy="beforeInteractive" crossOrigin="anonymous" />
        )}
        {children}
      </body>
    </html>
  );
}
