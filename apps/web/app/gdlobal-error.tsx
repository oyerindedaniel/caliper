"use client";

import { useCopy } from "./hooks/use-copy";
import localFont from "next/font/local";
import styles from "@/app/page.module.css";

const geistMono = localFont({
  src: "./fonts/GeistMonoVF.woff",
  variable: "--font-geist-mono",
});

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const { copied, copy } = useCopy();

  return (
    <html lang="en">
      <body
        className={geistMono.variable}
        style={{
          margin: 0,
          background: "#0a0a0a",
          color: "#fff",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          height: "100vh",
          fontFamily: "var(--font-geist-mono), ui-monospace, monospace",
        }}
      >
        <div className={styles.statusContainer}>
          <div className={styles.statusCode} style={{ color: "#f24e1e" }}>
            FATAL_ERR
          </div>
          <p className={styles.description}>
            <strong className={styles.strong}>CRITICAL_SYSTEM_HALT</strong>: A fatal error occurred
            in the root namespace. The application shell could not be initialized.
          </p>
          {error.digest && (
            <p
              className={styles.errorDigest}
              onClick={() => copy(error.digest!)}
              title="Click to copy ID"
            >
              {copied ? "ID_COPIED_TO_CLIPBOARD" : `SYSTEM_LOG_ID: ${error.digest}`}
            </p>
          )}
          <div className={styles.errorAction}>
            <button onClick={() => reset()} className={styles.errorReset}>
              RETRY_LOAD
            </button>
          </div>
        </div>
      </body>
    </html>
  );
}
