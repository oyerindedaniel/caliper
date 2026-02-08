import Link from "next/link";
import styles from "./page.module.css";

export default function NotFound() {
  return (
    <div className={styles.statusContainer}>
      <div className={styles.statusCode}>404</div>
      <p className={styles.description}>
        <strong className={styles.strong}>ERROR_NOT_FOUND</strong>: The requested resource could not
        be mapped within the Caliper namespace. Please verify the URL or return to the landing base.
      </p>
      <div className={styles.errorAction}>
        <Link href="/" className={styles.link}>
          ← Return to Landing Base
        </Link>
      </div>
    </div>
  );
}
