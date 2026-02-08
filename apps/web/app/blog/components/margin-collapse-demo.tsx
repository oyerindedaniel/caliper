"use client";

import { motion } from "motion/react";
import styles from "../../page.module.css";

export function MarginCollapseDemo() {
  return (
    <div className={styles.demoContainer}>
      <div className={styles.demoLabel}>INTENDED: 48PX GAP (24 + 24)</div>
      <div className={styles.demoStage}>
        <div
          style={{
            marginBottom: "24px",
            background: "var(--gray-alpha-200)",
            height: "40px",
            width: "100%",
            borderRadius: 4,
            position: "relative",
          }}
        >
          <span
            style={{
              position: "absolute",
              bottom: -20,
              left: 10,
              fontSize: 10,
              color: "var(--caliper-primary)",
            }}
          >
            margin-bottom: 24px
          </span>
        </div>

        {/* The Gap */}
        <div
          style={{
            height: "24px",
            background: "rgba(242, 78, 30, 0.1)",
            borderLeft: "2px solid #f24e1e",
            position: "relative",
          }}
        >
          <motion.span
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 1 }}
            style={{
              position: "absolute",
              left: 10,
              top: "50%",
              transform: "translateY(-50%)",
              fontSize: 12,
              fontWeight: 700,
              color: "#f24e1e",
            }}
          >
            OBSERVED: 24px (COLLAPSED)
          </motion.span>
        </div>

        <div
          style={{
            marginTop: "24px",
            background: "var(--gray-alpha-200)",
            height: "40px",
            width: "100%",
            borderRadius: 4,
            position: "relative",
          }}
        >
          <span
            style={{
              position: "absolute",
              top: -20,
              left: 10,
              fontSize: 10,
              color: "var(--caliper-primary)",
            }}
          >
            margin-top: 24px
          </span>
        </div>
      </div>
      <p className={styles.demoCaption}>
        The browser collapses the two 24px margins into a single 24px gap because they "touch"
        without a border or padding separating them.
      </p>
    </div>
  );
}
