import styles from "./page.module.css";

export function Instructions() {
    return (
        <>
            <h2 className={styles.sectionHeader}>How to Use</h2>
            <ul className={styles.instructionList}>
                <li className={styles.instructionItem}>
                    1. <strong>Ctrl + Click</strong> — Select an element to begin
                </li>
                <li className={styles.instructionItem}>
                    2. <strong>Hover</strong> — Change focus or view relative distances
                </li>
                <li className={styles.instructionItem}>
                    3. <strong>Alt</strong> — Hold to reveal the measurement overlay
                </li>
                <li className={styles.instructionItem}>
                    4. <strong>Space</strong> — Freeze the current measurements
                </li>
                <li className={styles.instructionItem}>
                    5. <strong>T, R, B, L, D</strong> — Open side calculator for selection
                </li>
            </ul>
        </>
    );
}
