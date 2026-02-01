import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";
import Script from "next/script";
import { Analytics } from "@vercel/analytics/react";
import { BASE_URL } from "./constants";
import { LogoTrail } from "./components/logo-trail-canvas";
import { CaliperWrapper } from "./caliper-wrapper";
import { ConfigProvider } from "./contexts/config-context";

const geistSans = localFont({
  src: "./fonts/GeistVF.woff",
  variable: "--font-geist-sans",
});
const geistMono = localFont({
  src: "./fonts/GeistMonoVF.woff",
  variable: "--font-geist-mono",
});

export const metadata: Metadata = {
  title: {
    default: "Caliper",
    template: "%s | Caliper",
  },
  description:
    "Essential tooling for detail-obsessed design engineers. High-precision measurement, projection, and layout auditing directly in your browser.",
  keywords: [
    "Caliper",
    "Design Tool",
    "Frontend Engineering",
    "Pixel Perfect",
    "CSS Auditing",
    "Daniel Oyerinde",
    "Measurement Tool",
  ],
  authors: [{ name: "Daniel Oyerinde" }],
  creator: "Daniel Oyerinde",
  metadataBase: new URL(BASE_URL),
  openGraph: {
    type: "website",
    locale: "en_US",
    url: BASE_URL,
    siteName: "Caliper",
    title: "Caliper - Detail-Obsessed Auditing",
    description:
      "Essential tooling for detail-obsessed design engineers. High-precision measurement, projection, and layout auditing directly in your browser.",
    images: [
      {
        url: "/og-image.png",
        width: 1200,
        height: 630,
        alt: "Caliper - Detail-Obsessed Auditing",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Caliper - Detail-Obsessed Auditing",
    description:
      "Essential tooling for detail-obsessed design engineers. High-precision measurement, projection, and layout auditing directly in your browser.",
    images: ["/og-image.png"],
    creator: "@fybnow",
  },
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${geistSans.variable} ${geistMono.variable}`} suppressHydrationWarning>
        {process.env.NODE_ENV === "development" && (
          <Script
            src="https://unpkg.com/react-scan/dist/auto.global.js"
            strategy="beforeInteractive"
          />
        )}
        <ConfigProvider>
          <CaliperWrapper />
          <LogoTrail />
          {children}
        </ConfigProvider>
        <Analytics />
      </body>
    </html>
  );
}
