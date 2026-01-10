"use client";

import styles from "./page.module.css";
import { useOS } from "./hooks/use-os";

export function TryCaliper() {
  const { getAltKey, getControlKey } = useOS();

  return (
    <section className={`${styles.section} ${styles.trySection}`}>
      <div className={styles.tryHeader}>
        <span className={styles.tryBadge}>Live Audit Playground</span>
        <p className={styles.tryHint}>
          Select an element (<strong>{getControlKey()} + Hold + Click</strong>), then hold{" "}
          <strong>{getAltKey()}</strong> and hover to measure. Press <strong>Space</strong> to
          freeze, then click any label to use the calculator.
        </p>
      </div>

      <div className={styles.playground}>
        <div className={styles.playgroundRow}>
          <div className={styles.playgroundBox} style={{ width: "120px", height: "48px" }}>
            <div className={styles.boxLabel}>120 × 48</div>
          </div>
          <div
            className={styles.playgroundBox}
            style={{ width: "160px", height: "48px", marginTop: "4px" }}
          >
            <div className={styles.boxLabel}>160 × 48</div>
          </div>
        </div>

        <div className={styles.playgroundRow}>
          <div className={styles.playgroundCircle} />
          <div className={styles.playgroundBox} style={{ flex: 1, height: "32px" }}>
            <div className={styles.boxLabel}>Flex Growth</div>
          </div>
          <div className={styles.playgroundCircle} />
        </div>

        <div className={styles.playgroundGrid}>
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div key={i} className={styles.playgroundGridItem}>
              <div className={styles.dot} />
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
