import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";
import Script from "next/script";
import { Analytics } from "@vercel/analytics/react";
import { BASE_URL, STORAGE_KEY } from "./constants";
import { LogoTrail } from "./components/logo-trail-canvas";
import { ConfigProvider } from "./contexts/config-context";
import { Nav } from "./components/nav";
import { Footer } from "./components/footer";
import { OnThisPage } from "./components/on-this-page";
import { FocusProvider } from "./contexts/focus-context";
import styles from "@/app/page.module.css";

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
    default: "Home | Caliper",
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
      <head>
        <script
          id="caliper-theme-bootstrap"
          dangerouslySetInnerHTML={{
            __html: `
              (function() {
                try {
                  const saved = localStorage.getItem("${STORAGE_KEY}");
                  if (saved) {
                    const config = JSON.parse(saved);
                    if (config.theme) {
                      window.__CALIPER_CONFIG__ = { theme: config.theme };
                      if (config.theme.primary) document.documentElement.style.setProperty("--caliper-primary", config.theme.primary);
                      if (config.theme.secondary) document.documentElement.style.setProperty("--caliper-secondary", config.theme.secondary);
                    }
                  }
                } catch (e) {}
              })();
            `,
          }}
        />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200"
        />
      </head>
      <body
        className={`${geistSans.className} ${geistSans.variable} ${geistMono.variable}`}
        suppressHydrationWarning
      >
        {process.env.NODE_ENV === "development" && (
          <Script
            src="https://unpkg.com/react-scan/dist/auto.global.js"
            strategy="beforeInteractive"
          />
        )}
        <Script
          // src={
          //   process.env.NODE_ENV === "production"
          //     ? "https://unpkg.com/@oyerinde/caliper/dist/index.global.js"
          //     : `/caliper.js?v=${Date.now()}`
          // }
          src={`/caliper.js?v=${Date.now()}`}
          strategy="beforeInteractive"
          crossOrigin="anonymous"
          data-config={JSON.stringify({
            bridge: { enabled: process.env.NODE_ENV === "development" },
          })}
        />
        <ConfigProvider>
          <FocusProvider>
            <LogoTrail />
            <div className={styles.page}>
              <main className={styles.main}>
                <Nav />
                {children}
              </main>
              <OnThisPage />
              <Footer />
            </div>
          </FocusProvider>
        </ConfigProvider>
        <Analytics />
      </body>
    </html>
  );
}
