"use client";

import { useEffect, useState, useRef, Suspense, useCallback } from "react";
import { usePathname } from "next/navigation";
import { useIsClient } from "@/app/hooks/use-is-client";
import styles from "./on-this-page.module.css";

interface TocItem {
  id: string;
  label: string;
}

export function OnThisPageSkeleton() {
  return (
    <div className={styles.tocWrapper}>
      <aside className={styles.toc}>
        <div className={styles.skeletonHeader}>
          <div className={styles.shimmer} />
        </div>
        <div className={styles.skeletonBody}>
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className={styles.skeletonItem}>
              <div className={styles.shimmer} />
            </div>
          ))}
        </div>
      </aside>
    </div>
  );
}

function OnThisPageContent() {
  const pathname = usePathname();
  const [tocItems, setTocItems] = useState<TocItem[]>([]);
  const [activeId, setActiveId] = useState<string>("");
  const [pillTop, setPillTop] = useState(0);

  const itemRefs = useRef<Record<string, HTMLElement | null>>({});
  const navContainerRef = useRef<HTMLDivElement | null>(null);

  const updatePillPosition = useCallback(() => {
    if (activeId && itemRefs.current[activeId]) {
      const activeItemElement = itemRefs.current[activeId];
      if (activeItemElement) {
        setPillTop(activeItemElement.offsetTop + activeItemElement.offsetHeight / 2 - 10);
      }
    }
  }, [activeId]);

  const isScrollingFromClick = useRef(false);
  const scrollClickTimer = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    const contentSections = document.querySelectorAll("section[id], h2[id]");
    const foundTocItems = Array.from(contentSections)
      .filter((el) => {
        return el.id && (el.tagName === "SECTION" || el.tagName === "H2");
      })
      .map((currentSection) => ({
        id: currentSection.id,
        label:
          (currentSection.tagName === "H2"
            ? currentSection.textContent
            : currentSection.querySelector("h2")?.textContent) || currentSection.id,
      }));
    setTocItems(foundTocItems);

    const initialActive = Array.from(contentSections).find((section) => {
      const rect = section.getBoundingClientRect();
      return rect.top >= -100 && rect.top <= window.innerHeight * 0.4;
    });

    if (initialActive) {
      setActiveId(initialActive.id);
    } else {
      const first = foundTocItems[0];
      if (first) setActiveId(first.id);
    }

    const intersectionObserver = new IntersectionObserver(
      (entries) => {
        if (isScrollingFromClick.current) return;

        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            const id = entry.target.id;
            setActiveId(id);
            if (window.location.hash !== `#${id}`) {
              window.history.replaceState(null, "", `#${id}`);
            }
          }
        });
      },
      { rootMargin: "-10% 0px -70% 0px", threshold: 0 }
    );

    contentSections.forEach((currentSection) => intersectionObserver.observe(currentSection));

    return () => {
      intersectionObserver.disconnect();
      if (scrollClickTimer.current) clearTimeout(scrollClickTimer.current);
    };
  }, [pathname]);

  useEffect(() => {
    updatePillPosition();
    const container = navContainerRef.current;
    if (!container) return;

    const resizeObserver = new ResizeObserver(() => {
      updatePillPosition();
    });
    resizeObserver.observe(container);

    return () => {
      resizeObserver.disconnect();
    };
  }, [updatePillPosition]);

  const handleTocClick = (sectionId: string) => {
    const targetSectionElement = document.getElementById(sectionId);
    if (targetSectionElement) {

      isScrollingFromClick.current = true;
      if (scrollClickTimer.current) clearTimeout(scrollClickTimer.current);
      scrollClickTimer.current = setTimeout(() => {
        isScrollingFromClick.current = false;
      }, 800);

      const scrollTargetTop =
        targetSectionElement.getBoundingClientRect().top + window.pageYOffset - 80;
      window.scrollTo({ top: scrollTargetTop, behavior: "smooth" });
      window.history.replaceState(null, "", `#${sectionId}`);
      setActiveId(sectionId);
    }
  };

  if (tocItems.length === 0) return null;

  return (
    <div className={styles.tocWrapper}>
      <aside className={styles.toc}>
        <div className={styles.tocHeader}>On This Page</div>
        <div className={styles.navContainer} ref={navContainerRef}>
          <div className={styles.track} />
          {activeId && (
            <div className={styles.pill} style={{ transform: `translateY(${pillTop}px)` }} />
          )}
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

export function OnThisPage() {
  const isClient = useIsClient();

  if (!isClient) {
    return <OnThisPageSkeleton />;
  }

  return (
    <Suspense fallback={<OnThisPageSkeleton />}>
      <OnThisPageContent />
    </Suspense>
  );
}
