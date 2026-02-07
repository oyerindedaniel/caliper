"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import styles from "../page.module.css";
import { Suspense } from "react";
import { motion } from "motion/react";

function NavContent() {
  const pathname = usePathname();

  const links = [
    { href: "/", label: "Home" },
    { href: "/docs/agentic", label: "Agents", badge: "Docs" },
    { href: "/faq", label: "FAQ" },
  ];

  return (
    <nav className={styles.navTop}>
      {links.map((link) => {
        const isActive = pathname === link.href;
        return (
          <Link
            key={link.href}
            href={link.href}
            className={`${styles.navLink} ${isActive ? styles.activeNavLink : ""}`}
            style={{ position: "relative" }}
          >
            <span>{link.label}</span>
            {link.badge && <span className={styles.newBadge}>{link.badge}</span>}
            {isActive && (
              <motion.div
                layoutId="nav-underline"
                className={styles.navUnderline}
                style={{ background: "var(--caliper-primary, #18a0fb)" }}
                transition={{
                  type: "spring",
                  stiffness: 380,
                  damping: 30,
                }}
              />
            )}
          </Link>
        );
      })}
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
