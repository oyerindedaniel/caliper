"use client";

import { useEffect, useState, useRef } from "react";
import styles from "./on-this-page.module.css";

interface TocItem {
    id: string;
    label: string;
}

export function OnThisPage() {
    const [tocItems, setTocItems] = useState<TocItem[]>([]);
    const [activeId, setActiveId] = useState<string>("");
    const [pillTop, setPillTop] = useState(0);
    const itemRefs = useRef<Record<string, HTMLElement | null>>({});

    useEffect(() => {
        const contentSections = document.querySelectorAll("section[id]");
        const foundTocItems = Array.from(contentSections).map((currentSection) => ({
            id: currentSection.id,
            label: currentSection.querySelector("h2")?.textContent || currentSection.id,
        }));
        setTocItems(foundTocItems);

        const intersectionObserver = new IntersectionObserver(
            (entries) => {
                entries.forEach((entry) => {
                    if (entry.isIntersecting) {
                        setActiveId(entry.target.id);
                    }
                });
            },
            { rootMargin: "-20% 0px -70% 0px", threshold: 0 }
        );

        contentSections.forEach((currentSection) => intersectionObserver.observe(currentSection));
        return () => intersectionObserver.disconnect();
    }, []);

    useEffect(() => {
        if (activeId && itemRefs.current[activeId]) {
            const activeItemElement = itemRefs.current[activeId];
            if (activeItemElement) {
                setPillTop(activeItemElement.offsetTop + activeItemElement.offsetHeight / 2 - 10); // 10 is half of pill height (20)
            }
        }
    }, [activeId, tocItems]);

    const handleTocClick = (sectionId: string) => {
        const targetSectionElement = document.getElementById(sectionId);
        if (targetSectionElement) {
            const scrollTargetTop =
                targetSectionElement.getBoundingClientRect().top + window.pageYOffset - 80;
            window.scrollTo({ top: scrollTargetTop, behavior: "smooth" });
        }
    };

    if (tocItems.length === 0) return null;

    return (
        <div className={styles.tocWrapper}>
            <aside className={styles.toc}>
                <div className={styles.tocHeader}>On This Page</div>
                <div className={styles.navContainer}>
                    <div className={styles.track} />
                    <div className={styles.pill} style={{ transform: `translateY(${pillTop}px)` }} />
                    <nav className={styles.navList}>
                        {tocItems.map((tocItem) => (
                            <a
                                key={tocItem.id}
                                ref={(itemElement) => {
                                    itemRefs.current[tocItem.id] = itemElement;
                                }}
                                className={`${styles.navItem} ${activeId === tocItem.id ? styles.activeItem : ""}`}
                                onClick={() => handleTocClick(tocItem.id)}
                            >
                                {tocItem.label}
                            </a>
                        ))}
                    </nav>
                </div>
            </aside>
        </div>
    );
}
