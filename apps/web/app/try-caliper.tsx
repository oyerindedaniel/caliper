"use client";

import { useState, useEffect, useLayoutEffect, useRef, useMemo, useCallback } from "react";
import { motion, AnimatePresence, useMotionValue, useTransform, type Variants } from "motion/react";
import { Inter } from "next/font/google";
import styles from "./page.module.css";
import { useOS } from "./hooks/use-os";
import { useConfig } from "./contexts/config-context";

const inter = Inter({ subsets: ["latin"] });

type Phase = "idle" | "select" | "measure" | "calc" | "project" | "ruler";

const PHASE_DURATION: Record<Phase, number> = {
  idle: 800,
  select: 2500,
  measure: 3000,
  calc: 3200,
  project: 2800,
  ruler: 3000,
};

const PHASES: Phase[] = ["select", "measure", "calc", "project", "ruler"];

const fadeIn: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { duration: 0.2 } },
  exit: { opacity: 0, transition: { duration: 0.15 } },
};

const scaleIn: Variants = {
  hidden: { opacity: 0, scale: 0.96 },
  visible: { opacity: 1, scale: 1, transition: { type: "spring", stiffness: 400, damping: 25 } },
  exit: { opacity: 0, scale: 0.96, transition: { duration: 0.15 } },
};

const slideUp: Variants = {
  hidden: { opacity: 0, y: 6 },
  visible: { opacity: 1, y: 0, transition: { type: "spring", stiffness: 300, damping: 20 } },
  exit: { opacity: 0, y: -4, transition: { duration: 0.12 } },
};

const CalculatorIcons = {
  "+": ({ color }: { color?: string }) => (
    <svg
      viewBox="0 0 24 24"
      style={{
        width: 12,
        height: 12,
        strokeWidth: 2.5,
        stroke: color || "currentColor",
        fill: "none",
        strokeLinecap: "round",
        strokeLinejoin: "round",
        display: "block",
      }}
    >
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  ),
};

const PlusIcon = CalculatorIcons["+"];

export function TryCaliper() {
  const { getAltKey, getControlKey } = useOS();
  const { theme, commands } = useConfig();
  const [phase, setPhase] = useState<Phase>("idle");
  const [isPaused, setIsPaused] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const box1Ref = useRef<HTMLDivElement>(null);
  const box2Ref = useRef<HTMLDivElement>(null);

  const b1x = useMotionValue(0);
  const b1y = useMotionValue(0);
  const b1w = useMotionValue(0);
  const b1h = useMotionValue(0);

  const b2x = useMotionValue(0);
  const b2y = useMotionValue(0);
  const b2w = useMotionValue(0);
  const b2h = useMotionValue(0);

  const containerHeight = useMotionValue(200);
  const containerWidth = useMotionValue(0);

  const updatePositions = useCallback(() => {
    const container = containerRef.current;
    const box1 = box1Ref.current;
    const box2 = box2Ref.current;
    if (!container || !box1 || !box2) return;

    const cRect = container.getBoundingClientRect();
    const b1Rect = box1.getBoundingClientRect();
    const b2Rect = box2.getBoundingClientRect();

    b1x.set(b1Rect.left - cRect.left);
    b1y.set(b1Rect.top - cRect.top);
    b1w.set(b1Rect.width);
    b1h.set(b1Rect.height);

    b2x.set(b2Rect.left - cRect.left);
    b2y.set(b2Rect.top - cRect.top);
    b2w.set(b2Rect.width);
    b2h.set(b2Rect.height);

    containerHeight.set(container.offsetHeight);
    containerWidth.set(container.offsetWidth);
  }, [b1x, b1y, b1w, b1h, b2x, b2y, b2w, b2h, containerHeight, containerWidth]);

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const observer = new ResizeObserver(updatePositions);
    observer.observe(container);

    if (box1Ref.current) observer.observe(box1Ref.current);
    if (box2Ref.current) observer.observe(box2Ref.current);

    updatePositions();
    return () => observer.disconnect();
  }, [updatePositions]);

  useEffect(() => {
    if (isPaused) return;

    const duration = PHASE_DURATION[phase];
    const timer = setTimeout(() => {
      const currentIdx = PHASES.indexOf(phase);
      const nextIdx = phase === "idle" ? 0 : (currentIdx + 1) % PHASES.length;
      setPhase(PHASES[nextIdx] ?? "select");
    }, duration);

    return () => clearTimeout(timer);
  }, [phase, isPaused]);

  const gap = useTransform([b1x, b1w, b2x], ([x1, w1, x2]) =>
    Math.round(Number(x2) - (Number(x1) + Number(w1)))
  );
  const b1MidY = useTransform([b1y, b1h], ([y, h]) => Number(y) + Number(h) / 2);
  const b1Right = useTransform([b1x, b1w], ([x, w]) => Number(x) + Number(w));
  const b1MidX = useTransform([b1x, b1w], ([x, w]) => Number(x) + Number(w) / 2);
  const gapMidX = useTransform([b1Right, gap], ([right, g]) => Number(right) + Number(g) / 2);

  // + 10: Vertical offset to place the calculator below the selection box
  const calcTop = useTransform([b1y, b1h], ([y, h]) => Number(y) + Number(h) + 10);
  const projectHeight = useTransform([b1y], ([y]) => Number(y));

  // / 2 - 9: Halfway point minus half label height (approx 18px / 2) to center the label
  const projectMidY = useTransform([b1y], ([y]) => Number(y) / 2 - 9);

  // + 8: Horizontal offset to place the label to the right of the projection line
  const projectLabelX = useTransform([b1MidX], ([midX]) => Number(midX) + 8);

  const projectLabelVal = useTransform(b1y, (y) => Math.round(Number(y)));

  // + 12: Represents the "simulated input" value being added in the calculator phase
  const calcResultVal = useTransform(b1w, (w) => Math.round(Number(w)) + 12);

  const b1wRound = useTransform(b1w, (w) => Math.round(Number(w)));
  const rulerLineY = useTransform(containerHeight, (h) => Number(h) * 0.6);
  const rulerLabelY = useTransform(rulerLineY, (y) => Number(y) + 6);
  const rulerX = useTransform(containerWidth, (w) => Number(w) * 0.6);
  const rulerLabelX = useTransform(rulerX, (x) => Number(x) + 6);

  const phaseDescription = useMemo(() => {
    switch (phase) {
      case "idle":
        return "Ready to audit...";
      case "select":
        return "Select elements with precision.";
      case "measure":
        return "Measure gaps and relative distances.";
      case "calc":
        return "Perform arithmetic on layout values.";
      case "project":
        return "Project edges to page boundaries.";
      case "ruler":
        return "Place and nudge alignment guides.";
      default:
        return "";
    }
  }, [phase]);

  return (
    <section
      id="playground"
      className={`${styles.section} ${styles.trySection} ${inter.className}`}
    >
      <div className={styles.tryHeader}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 16,
          }}
        >
          <span className={styles.tryBadge}>Live Audit Playground</span>
          <button
            onClick={() => setIsPaused(!isPaused)}
            className={`${styles.btnBase} ${styles.btnSecondary} ${styles.tryToggle}`}
          >
            <span className={`material-symbols-outlined fs-18`}>
              {isPaused ? "play_arrow" : "pause"}
            </span>
            {isPaused ? "Play" : "Pause"}
          </button>
        </div>
        <p className={styles.tryHint}>
          Select an element (<strong>{getControlKey()} + Click + Hold</strong>), then hold{" "}
          <strong>{getAltKey()}</strong> and hover to measure. Press <strong>Space</strong> to
          freeze, then use the calculator.
        </p>
        <div style={{ overflow: "hidden" }}>
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={phase}
              initial={{ y: 12, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: -12, opacity: 0 }}
              transition={{
                duration: 0.6,
                ease: [0.19, 1, 0.22, 1],
              }}
              style={{
                fontSize: 12,
                fontFamily: "var(--font-geist-mono)",
                margin: 0,
                color: "var(--caliper-primary, #18a0fb)",
                display: "flex",
                alignItems: "center",
                gap: 12,
                height: "100%",
              }}
            >
              <span style={{ opacity: 0.9 }}>{phaseDescription}</span>
              {phase !== "idle" && (
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    background:
                      "color-mix(in srgb, var(--caliper-primary, #18a0fb), transparent 90%)",
                    padding: "2px 8px",
                    borderRadius: 4,
                    border:
                      "1px solid color-mix(in srgb, var(--caliper-primary, #18a0fb), transparent 80%)",
                    fontSize: 10,
                    fontWeight: 700,
                    textTransform: "uppercase",
                    letterSpacing: "0.06em",
                    color: "var(--caliper-primary, #18a0fb)",
                  }}
                >
                  <span style={{ opacity: 0.9 }}>CMD:</span>
                  <span style={{ opacity: 0.9 }}>
                    {(() => {
                      const displayKey = (k: string) => (k === " " ? "SPACE" : k);
                      if (phase === "select") return displayKey(commands.select);
                      if (phase === "measure") return displayKey(commands.activate);
                      if (phase === "calc") return displayKey(commands.freeze);
                      if (phase === "project")
                        return `${commands.projTop}${commands.projLeft}${commands.projBottom}${commands.projRight}`.toUpperCase();
                      if (phase === "ruler") return displayKey(commands.ruler);
                      return "";
                    })()}
                  </span>
                </div>
              )}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>

      <div
        className={styles.playground}
        ref={containerRef}
        style={{ position: "relative", overflow: "visible" }}
      >
        <div className={styles.playgroundRow}>
          <div ref={box1Ref} className={styles.playgroundBox} style={{ width: 120, height: 48 }}>
            <span className={styles.boxLabel}>Target A</span>
          </div>
          <div
            ref={box2Ref}
            className={styles.playgroundBox}
            style={{ width: 160, height: 48, marginTop: 4 }}
          >
            <span className={styles.boxLabel}>Target B</span>
          </div>
        </div>

        <div className={styles.playgroundRow}>
          <div className={styles.playgroundCircle} />
          <div className={styles.playgroundBox} style={{ flex: 1, height: 32 }}>
            <span className={styles.boxLabel}>Flex Growth</span>
          </div>
          <div className={styles.playgroundCircle} />
        </div>

        <div
          style={{
            position: "absolute",
            inset: 0,
            pointerEvents: "none",
            zIndex: 10,
          }}
        >
          <AnimatePresence>
            {["select", "measure", "calc", "project"].includes(phase) && (
              <motion.div
                key="selection-box"
                variants={scaleIn}
                initial="hidden"
                animate="visible"
                exit="exit"
                style={{
                  position: "absolute",
                  top: b1y,
                  left: b1x,
                  width: b1w,
                  height: b1h,
                  border: `2px solid ${theme.primary}`,
                  borderRadius: 2,
                }}
              >
                <div
                  style={{
                    position: "absolute",
                    top: -18,
                    left: -2,
                    background: theme.primary,
                    color: "#fff",
                    padding: "2px 6px",
                    fontSize: 10,
                    fontWeight: 600,
                    fontFamily: "inherit",
                    borderRadius: "2px 2px 0 0",
                    whiteSpace: "nowrap",
                  }}
                >
                  Selected
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          <AnimatePresence mode="wait">
            {phase === "measure" && (
              <motion.div
                key="measure"
                variants={fadeIn}
                initial="hidden"
                animate="visible"
                exit="exit"
              >
                <motion.div
                  initial={{ scaleX: 0 }}
                  animate={{ scaleX: 1 }}
                  transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
                  style={{
                    position: "absolute",
                    top: b1MidY,
                    left: b1Right,
                    width: gap,
                    height: 0,
                    borderTop: `1px dashed ${theme.secondary}`,
                    transformOrigin: "left",
                  }}
                />
                <motion.div
                  variants={slideUp}
                  initial="hidden"
                  animate="visible"
                  style={{
                    position: "absolute",
                    top: b1MidY,
                    y: -22,
                    left: gapMidX,
                    transform: "translateX(-50%)",
                    background: theme.secondary,
                    color: "#fff",
                    padding: "2px 6px",
                    fontSize: 11,
                    fontWeight: 500,
                    fontFamily: "inherit",
                    borderRadius: 3,
                  }}
                >
                  <motion.span>{gap}</motion.span>px
                </motion.div>
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 0.5 }}
                  style={{
                    position: "absolute",
                    top: b2y,
                    left: b2x,
                    width: b2w,
                    height: b2h,
                    border: `1px dashed ${theme.secondary}`,
                    borderRadius: 3,
                  }}
                />
              </motion.div>
            )}

            {phase === "calc" && (
              <motion.div
                key="calc"
                variants={scaleIn}
                initial="hidden"
                animate="visible"
                exit="exit"
                style={{
                  position: "absolute",
                  top: calcTop,
                  left: b1MidX,
                  transform: "translateX(-50%)",
                  background: theme.calcBg,
                  color: theme.calcText,
                  padding: "0 8px",
                  height: 28,
                  borderRadius: 4,
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  fontSize: 12,
                  fontWeight: 500,
                  fontFamily: "inherit",
                  boxShadow: `0 0 0 2px color-mix(in srgb, ${theme.primary}, transparent 50%), 0 4px 12px ${theme.calcShadow}`,
                  border: `1px solid ${theme.primary}`,
                  userSelect: "none",
                }}
              >
                <motion.span style={{ opacity: 0.7 }}>{b1wRound}</motion.span>
                <motion.span
                  initial={{ opacity: 0, scale: 1.3 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ delay: 0.25 }}
                  style={{
                    backgroundColor: theme.calcOpHighlight,
                    padding: 4,
                    height: 20,
                    borderRadius: 2,
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: theme.primary,
                  }}
                >
                  <PlusIcon color="#fff" />
                </motion.span>
                <motion.span
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 0.5 }}
                >
                  12
                </motion.span>
                <motion.span
                  initial={{ opacity: 0, x: -6 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.85 }}
                  style={{ color: theme.primary, fontWeight: "bold" }}
                >
                  = <motion.span>{calcResultVal}</motion.span>
                </motion.span>
              </motion.div>
            )}

            {phase === "project" && (
              <motion.div
                key="project"
                variants={fadeIn}
                initial="hidden"
                animate="visible"
                exit="exit"
              >
                <motion.div
                  initial={{ scaleX: 0 }}
                  animate={{ scaleX: 1 }}
                  transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
                  style={{
                    position: "absolute",
                    top: b1y,
                    left: 0,
                    width: b1x,
                    height: 0,
                    borderTop: `1px dashed ${theme.projection}`,
                    opacity: 0.5,
                  }}
                />

                <motion.div
                  initial={{ scaleY: 0 }}
                  animate={{ scaleY: 1 }}
                  transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1], delay: 0.1 }}
                  style={{
                    position: "absolute",
                    top: 0,
                    left: b1MidX,
                    width: 0,
                    height: projectHeight,
                    borderLeft: `2px dashed ${theme.projection}`,
                    transformOrigin: "top",
                  }}
                />

                <motion.div
                  variants={slideUp}
                  initial="hidden"
                  animate="visible"
                  transition={{ delay: 0.25 }}
                  style={{
                    position: "absolute",
                    top: b1y,
                    y: -38, // Adjusted for 28px height + 10px margin
                    left: b1x,
                    background: theme.calcBg,
                    border: `1px solid ${theme.primary}`,
                    borderLeft: `3px solid ${theme.projection}`,
                    boxShadow: `0 4px 12px ${theme.calcShadow}`,
                    padding: "0 8px",
                    height: 28,
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    borderRadius: 4,
                    fontSize: 12,
                    fontWeight: 500,
                    color: theme.calcText,
                  }}
                >
                  <span
                    style={{
                      background: theme.projection.replace("1)", "0.2)"),
                      color: theme.projection,
                      fontSize: 10,
                      padding: "2px 4px",
                      borderRadius: 2,
                      textTransform: "uppercase",
                      fontWeight: 700,
                    }}
                  >
                    top
                  </span>
                  <motion.span style={{ color: theme.projection, fontWeight: "bold" }}>
                    {projectLabelVal}
                  </motion.span>
                </motion.div>

                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 0.4 }}
                  style={{
                    position: "absolute",
                    top: projectMidY,
                    left: projectLabelX,
                    background: theme.projection,
                    color: "#fff",
                    padding: "2px 6px",
                    fontSize: 11,
                    fontWeight: 500,
                    borderRadius: 3,
                  }}
                >
                  <motion.span>{projectLabelVal}</motion.span>
                </motion.div>
              </motion.div>
            )}

            {phase === "ruler" && (
              <motion.div
                key="ruler"
                variants={fadeIn}
                initial="hidden"
                animate="visible"
                exit="exit"
              >
                <motion.div
                  initial={{ y: containerHeight.get() * 0.4 }}
                  animate={{ y: 0 }}
                  transition={{ type: "spring", stiffness: 200, damping: 20 }}
                  style={{
                    position: "absolute",
                    top: rulerLineY,
                    left: 0,
                    right: 0,
                    height: 1,
                    background: theme.ruler,
                    boxShadow: `0 0 6px ${theme.ruler}`,
                  }}
                />
                <motion.div
                  initial={{ x: containerWidth.get() * 0.4 }}
                  animate={{ x: 0 }}
                  transition={{ type: "spring", stiffness: 200, damping: 20, delay: 0.1 }}
                  style={{
                    position: "absolute",
                    top: 0,
                    bottom: 0,
                    width: 1,
                    background: theme.ruler,
                    boxShadow: `0 0 6px ${theme.ruler}`,
                    left: rulerX,
                  }}
                />
                <motion.div
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ delay: 0.5 }}
                  style={{
                    position: "absolute",
                    top: rulerLabelY,
                    left: rulerLabelX,
                    background: theme.primary,
                    color: "#fff",
                    padding: "2px 6px",
                    fontSize: 10,
                    fontWeight: 600,
                    fontFamily: "inherit",
                    borderRadius: 2,
                    boxShadow: "0 2px 6px rgba(0,0,0,0.15)",
                  }}
                >
                  Guide
                </motion.div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <div className={styles.playgroundGrid}>
          {Array.from({ length: 9 }).map((_, i) => (
            <div key={i} className={styles.playgroundGridItem}>
              <div className={styles.dot} />
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
