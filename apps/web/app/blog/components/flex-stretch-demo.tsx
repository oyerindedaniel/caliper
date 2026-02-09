"use client";

import styles from "@/app/page.module.css";

export function FlexStretchDemo() {
  return (
    <div className={styles.demoContainer}>
      <div className={styles.demoLabel}>AUDIT: FLEX_STRETCH_INCONSISTENCY</div>
      <div className={styles.demoStage}>
        <div className={styles.flexParentNode}>
          <div className={styles.parentLabel}>PARENT: DISPLAY_FLEX (DEFAULT_ALIGN: STRETCH)</div>

          <div className={styles.flexChild}>
            <span
              style={{
                fontFamily: "var(--font-geist-mono)",
                fontSize: 11,
                color: "var(--caliper-primary)",
                fontWeight: 600,
              }}
            >
              CHILD_A
            </span>
            <div className={styles.intentLabel}>
              <span>INTENT: INLINE_BLOCK (AUTO SIZE)</span>
            </div>

            <div className={styles.stretchedMeasure}>
              <span style={{ color: "var(--caliper-secondary)", fontSize: 10, marginLeft: -4 }}>
                ◂
              </span>
              <span className={styles.stretchedLabel}>STRETCHED: 100%</span>
              <span style={{ color: "var(--caliper-secondary)", fontSize: 10, marginRight: -4 }}>
                ▸
              </span>
            </div>
          </div>
        </div>
      </div>
      <div className={styles.demoCaption}>
        <span style={{ color: "var(--caliper-primary)" }}>DIAGNOSIS:</span> Parent Flex-Align
        defaults to <span style={{ color: "var(--caliper-secondary)" }}>stretch</span>. Inline-BLOCK
        intent is overridden by flex geometry rules.
      </div>
    </div>
  );
}
