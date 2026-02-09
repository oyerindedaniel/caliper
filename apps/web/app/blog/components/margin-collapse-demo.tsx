"use client";

import { motion } from "motion/react";
import styles from "@/app/page.module.css";

export function MarginCollapseDemo() {
  return (
    <div className={styles.demoContainer}>
      <div className={styles.demoLabel}>AUDIT: MARGIN_COLLAPSE_DISCREPANCY</div>
      <div className={styles.demoStage}>
        <div className={styles.demoNode}>
          <span style={{ fontFamily: "var(--font-geist-mono)", fontSize: 11, opacity: 0.3 }}>
            NODE_A
          </span>
          <div className={`${styles.marginLabel} ${styles.mbLabel}`}>
            <span>mb: 24px</span>
            <span style={{ fontSize: 12, lineHeight: 1 }}>↓</span>
          </div>
        </div>
        <div className={styles.marginGap}>
          <div className={styles.measurementBracket}>
            <div
              style={{
                width: 1,
                height: "100%",
                background: "var(--caliper-secondary)",
                opacity: 0.5,
              }}
            />
          </div>

          <motion.span
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            style={{
              fontFamily: "var(--font-geist-mono)",
              fontSize: 10,
              fontWeight: 700,
              color: "var(--caliper-secondary)",
              letterSpacing: "0.05em",
              textShadow: "0 0 10px color-mix(in srgb, var(--caliper-secondary), transparent 60%)",
            }}
          >
            OBSERVED: 24.0px
          </motion.span>
        </div>

        <div className={styles.demoNode}>
          <span style={{ fontFamily: "var(--font-geist-mono)", fontSize: 11, opacity: 0.3 }}>
            NODE_B
          </span>

          <div className={`${styles.marginLabel} ${styles.mtLabel}`}>
            <span style={{ fontSize: 12, lineHeight: 1 }}>↑</span>
            <span>mt: 24px</span>
          </div>
        </div>
      </div>
      <div className={styles.demoCaption}>
        <span style={{ color: "var(--caliper-primary)" }}>DIAGNOSIS:</span> Adjacent vertical
        margins have collapsed. Reality (24px) != Intent (24px + 24px).
      </div>
    </div>
  );
}
