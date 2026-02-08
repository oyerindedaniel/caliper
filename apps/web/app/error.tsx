"use client";

import { useEffect } from "react";
import styles from "./page.module.css";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className={styles.statusContainer}>
      <div className={styles.statusCode}>ERR_CRASH</div>
      <p className={styles.description}>
        <strong className={styles.strong}>SYSTEM_AUDIT_FAILURE</strong>: An unexpected runtime
        exception occurred. The current execution context has been terminated. Error:{" "}
        {error.message || "Unknown internal failure"}
      </p>
      <div className={styles.errorAction}>
        <button onClick={() => reset()} className={styles.link}>
          ↻ Attempt Context Reset
        </button>
      </div>
    </div>
  );
}
