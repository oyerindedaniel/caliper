"use client";

import Image from "next/image";
import Link from "next/link";
import styles from "../page.module.css";
import { Footer } from "../footer";

export default function Changelog() {
    return (
        <div className={styles.page}>
            <main className={styles.main}>
                <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '20px' }}>
                    <Link href="/">
                        <Image
                            className="imgDark"
                            src="/caliper_logo.svg"
                            alt="Caliper logo"
                            width={171.5}
                            height={50}
                            priority
                            unoptimized
                        />
                    </Link>
                </div>

                <h1 className={styles.sectionHeader} style={{ fontSize: '1.5rem', opacity: 1, textTransform: 'none', marginTop: '0' }}>
                    Changelog
                </h1>
                <p className={styles.instructionItem} style={{ marginBottom: '24px' }}>
                    All notable changes to this project will be documented in this file.
                </p>

                <h2 className={styles.subHeader} style={{ fontSize: '1.2rem', opacity: 1, textTransform: 'none', color: 'var(--caliper-primary, #18A0FB)' }}>
                    [0.1.0] — 2026-01-08
                </h2>

                <h3 className={styles.subHeader} style={{ fontSize: '0.9rem', marginTop: '16px' }}>
                    Added
                </h3>
                <ul className={styles.instructionList}>
                    <li className={styles.instructionItem}>
                        - <strong>Core Measurement System</strong>: High-precision boundary detection and distance calculation between DOM elements.
                    </li>
                    <li className={styles.instructionItem}>
                        - <strong>Interactive Overlay</strong>: Real-time measurement lines and labels with smooth animations.
                    </li>
                    <li className={styles.instructionItem}>
                        - <strong>Selection System</strong>: Ability to focus and lock elements for side-by-side comparison.
                    </li>
                    <li className={styles.instructionItem}>
                        - <strong>Viewport Rulers</strong>: Draggable horizontal and vertical guidelines for design layout audits.
                    </li>
                    <li className={styles.instructionItem}>
                        - <strong>Projection Visualizer</strong>: Automatic edge projection for checking alignment across the entire viewport.
                    </li>
                    <li className={styles.instructionItem}>
                        - <strong>Integrated Calculator</strong>: Precise spatial math and side-to-side distance calculations.
                    </li>
                    <li className={styles.instructionItem}>
                        - <strong>Configurable Commands</strong>: Custom keyboard shortcuts for all major features (Alt, Shift + R, etc.).
                    </li>
                    <li className={styles.instructionItem}>
                        - <strong>Theme Support</strong>: Custom primary colors and UI styling via CSS variables.
                    </li>
                    <li className={styles.instructionItem}>
                        - <strong>Two-Entry Distribution</strong>: Separate <code>index.js</code> for module-based usage and <code>index.global.js</code> for self-mounting script tags.
                    </li>
                    <li className={styles.instructionItem}>
                        - <strong>Next.js Integration</strong>: Support for Next.js Script component with data-attribute configuration.
                    </li>
                </ul>

                <div style={{ marginTop: '40px' }}>
                    <Link href="/" className={styles.copyButton} style={{ textDecoration: 'none', width: 'auto', display: 'inline-flex', padding: '10px 24px' }}>
                        ← Back to Home
                    </Link>
                </div>
            </main>

            <Footer />
        </div>
    );
}
