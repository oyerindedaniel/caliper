"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import styles from "../page.module.css";
import { Suspense } from "react";

function NavContent() {
  const pathname = usePathname();

  if (pathname?.startsWith("/changelog")) {
    return null;
  }

  return (
    <nav className={styles.navTop}>
      {pathname !== "/" && (
        <Link href="/" className={styles.navLink}>
          <span>Home</span>
        </Link>
      )}
      {pathname !== "/docs/agentic" && (
        <Link href="/docs/agentic" className={styles.navLink}>
          <span>Agents</span>
          <span className={styles.newBadge}>Docs</span>
        </Link>
      )}
      {pathname !== "/faq" && (
        <Link href="/faq" className={styles.navLink}>
          <span>FAQ</span>
        </Link>
      )}
    </nav>
  );
}

export function Nav() {
  return (
    <Suspense fallback={null}>
      <NavContent />
    </Suspense>
  );
}
