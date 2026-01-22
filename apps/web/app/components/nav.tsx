"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import styles from "../page.module.css";

export function Nav() {
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
                    <span>AI Implementation</span>
                    <span className={styles.newBadge}>Docs</span>
                </Link>
            )}
        </nav>
    );
}
