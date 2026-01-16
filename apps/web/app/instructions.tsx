import styles from "./page.module.css";
import { useOS } from "./hooks/use-os";

export function Instructions() {
  const { getControlKey, getAltKey } = useOS();

  return (
    <section className={styles.section}>
      <h2 className={styles.sectionHeader}>How to Use</h2>

      <h3 className={styles.subHeader}>Core Measurement</h3>
      <ul className={styles.instructionList}>
        <li className={styles.instructionItem}>
          1. <strong>{getControlKey()} + Click + Hold </strong> — Select an element to begin (250ms
          hold)
        </li>
        <li className={styles.instructionItem}>
          2. <strong>Hover</strong> — Change focus or view relative distances
        </li>
        <li className={styles.instructionItem}>
          3. <strong>{getAltKey()} + Hover</strong> — Hold to reveal measurements to other elements
        </li>
        <li className={styles.instructionItem}>
          4. <strong>Space</strong> — Freeze the current measurements
        </li>
        <li className={styles.instructionItem}>
          5. <strong>T, R, B, L, G</strong> (or <strong>Click</strong>) — Send distances directly to
          the calculator.
        </li>
      </ul>

      <h3 className={styles.subHeader}>Projection (Edge Alignment)</h3>
      <ul className={styles.instructionList}>
        <li className={styles.instructionItem}>
          <strong>W / A / S / D</strong> — Project element edges across the viewport to check
          alignment.
        </li>
        <li className={styles.instructionItem}>
          <strong>Numeric Input</strong> — While projecting, type a number to align the projection
          to a specific edge distance.
        </li>
      </ul>

      <h3 className={styles.subHeader}>Viewport Rulers</h3>
      <ul className={styles.instructionList}>
        <li className={styles.instructionItem}>
          <strong>Shift + R</strong> — Create a pair of vertical and horizontal guidelines at the
          cursor.
        </li>
        <li className={styles.instructionItem}>
          <strong>Precision Control</strong> — Select a ruler and use <strong>Arrow Keys</strong> to
          nudge.
          <span style={{ opacity: 0.6, fontSize: "12px", display: "block", marginTop: "4px" }}>
            Shift+Arrow: 10px | {getAltKey()}+Arrow: 0.1px
          </span>
        </li>
        <li className={styles.instructionItem}>
          <strong>Chained Measurement</strong> — <strong>Shift + Click</strong> multiple parallel
          rulers to calculate and reveal distances between them.
        </li>
        <li className={styles.instructionItem}>
          <strong>Magnetic Snapping</strong> — Rulers automatically snap to active projection lines
          when dragged nearby.
        </li>
        <li className={styles.instructionItem}>
          <strong>Deselect/Remove</strong> — Click empty space to deselect; press{" "}
          <strong>Delete/Backspace</strong> to remove.
        </li>
        <li className={styles.instructionItem}>
          <strong>Input Priority</strong> — Typing operators (<strong>+ - * / .</strong>)
          automatically focuses the calculator for instant audits.
        </li>
        <li className={styles.instructionItem}>
          <strong>Escape</strong> — Clear all rulers, calculators, and projections.
        </li>
      </ul>

      <h3 className={styles.subHeader}>Excluding Elements</h3>
      <ul className={styles.instructionList}>
        <li className={styles.instructionItem}>
          <strong>data-caliper-ignore</strong> — Add this attribute to any element you want Caliper
          to skip during measurement and snapping.
        </li>
      </ul>
    </section>
  );
}
