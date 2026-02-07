"use client";

import localFont from "next/font/local";
import styles from "./page.module.css";

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
                <div className={styles.notFound}>
                    <div className={styles.errorCode} style={{ color: "#f24e1e" }}>
                        FATAL_ERR
                    </div>
                    <p className={styles.errorDescription}>
                        <strong className={styles.strong}>CRITICAL_SYSTEM_HALT</strong>: A fatal error occurred
                        in the root namespace. The application shell could not be initialized.
                    </p>
                    <div className={styles.errorAction}>
                        <button onClick={() => reset()} className={styles.errorReset}>
                            RESTART_SYSTEM
                        </button>
                    </div>
                </div>
            </body>
        </html>
    );
}
