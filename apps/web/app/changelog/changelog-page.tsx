"use client";

import Image from "next/image";
import Link from "next/link";
import styles from "../page.module.css";
import { Footer } from "../footer";

export default function ChangelogPage() {
    return (
        <div className={styles.page} data-caliper-ignore>
            <main className={styles.main}>
                <div style={{ marginBottom: '32px' }}>
                    <Link href="/" style={{
                        color: 'var(--gray-rgb)',
                        textDecoration: 'none',
                        fontSize: '14px',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '4px',
                        opacity: 0.6,
                        transition: 'opacity 0.2s',
                        fontFamily: 'var(--font-geist-sans)'
                    }} onMouseOver={(e) => e.currentTarget.style.opacity = '1'}
                        onMouseOut={(e) => e.currentTarget.style.opacity = '0.6'}>
                        ← Back to Home
                    </Link>
                </div>

                <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '20px' }}>
                    <Image
                        src="/caliper_logo.svg"
                        alt="Caliper logo"
                        width={171.5}
                        height={50}
                        priority
                        unoptimized
                    />
                </div>

                <h1 className={styles.sectionHeader} style={{
                    fontSize: '1.5rem',
                    opacity: 1,
                    textTransform: 'none',
                    marginTop: '0',
                    fontFamily: 'var(--font-geist-sans)'
                }}>
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
                        - <strong>Universal Integration</strong>: Zero-config support for Next.js, Vite, or any HTML page via script tag.
                    </li>
                </ul>

            </main>

            <Footer />
        </div>
    );
}
