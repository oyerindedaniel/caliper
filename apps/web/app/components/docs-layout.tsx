import { ReactNode } from "react";
import styles from "../page.module.css";
import { Footer } from "../footer";

interface DocSectionProps {
    title: string;
    children: ReactNode;
    style?: React.CSSProperties;
}

export function DocSection({ title, children, style }: DocSectionProps) {
    return (
        <section className={styles.section} style={style}>
            <h2 className={styles.sectionHeader}>{title}</h2>
            {children}
        </section>
    );
}

interface DocHeaderProps {
    title: string;
    description: string;
}

export function DocHeader({ title, description }: DocHeaderProps) {
    return (
        <div style={{ display: "flex", flexDirection: "column", gap: "12px", marginBottom: "48px" }}>
            <h1 className={styles.changelogTitle}>{title}</h1>
            <p>{description}</p>
        </div>
    );
}

import { Nav } from "./nav";

export function DocPageLayout({ children }: { children: ReactNode }) {
    return (
        <div className={styles.page}>
            <main className={styles.main}>
                <Nav />
                {children}
            </main>
            <Footer />
        </div>
    );
}
