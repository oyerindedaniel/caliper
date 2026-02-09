"use client";

import { useEffect } from "react";
import Link from "next/link";
import styles from "@/app/page.module.css";

export default function ChangelogError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Changelog segment error:", error);
  }, [error]);

  return (
    <div className={styles.statusContainer}>
      <div className={styles.statusCode} style={{ color: "#f24e1e" }}>
        LOAD_FAIL
      </div>
      <p className={styles.description}>
        <strong className={styles.strong}>FS_READ_ERROR</strong>: The changelog stream was
        interrupted or the source file is inaccessible.
      </p>
      <div className={styles.errorAction} style={{ display: "flex", gap: "12px" }}>
        <button onClick={() => reset()} className={styles.errorReset}>
          RETRY_LOAD
        </button>
        <Link href="/" className={styles.errorReset} style={{ textDecoration: "none" }}>
          RETURN_HOME
        </Link>
      </div>
    </div>
  );
}
