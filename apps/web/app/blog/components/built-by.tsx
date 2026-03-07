"use client";

import styles from "@/app/page.module.css";
import Image from "next/image";

export function BuiltBy() {
  return (
    <div className={styles.builtByContainer}>
      <div className={styles.builtByContent}>
        <div className={styles.builtByLeft}>
          <Image
            src="/caliper_logo.svg"
            alt="Caliper logo"
            width={120}
            height={35}
            priority
            unoptimized
            className={styles.placeholderAvatar}
          />
          <div className={styles.builtByInfo}>
            <span className={styles.builtByLabel}>THE_CORE_PRINCIPLE</span>
            <h4 className={styles.builtByTitle}>Engineering Absolute Certainty</h4>
            <p className={styles.builtByText}>
              Caliper establishes layout ground truth. We resolve the geometric edge cases like
              scroll hierarchies and subpixel rounding that standard tools ignore.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
