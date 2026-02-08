"use client";

import { motion } from "motion/react";
import styles from "../../page.module.css";

export function AgentReasoningDemo() {
  return (
    <div className={styles.demoContainer} style={{ height: 240 }}>
      <div
        className={styles.demoStage}
        style={{ position: "relative", height: "100%", overflow: "hidden" }}
      >
        {/* Mock UI Elements */}
        <div
          style={{
            position: "absolute",
            top: 40,
            left: 40,
            width: 120,
            height: 32,
            background: "var(--gray-alpha-200)",
            borderRadius: 4,
          }}
        />
        <div
          style={{
            position: "absolute",
            top: 40,
            left: 180,
            width: 80,
            height: 32,
            background: "var(--gray-alpha-200)",
            borderRadius: 4,
          }}
        />
        <div
          style={{
            position: "absolute",
            top: 120,
            left: 40,
            width: "calc(100% - 80px)",
            height: 60,
            background: "var(--gray-alpha-200)",
            borderRadius: 4,
          }}
        />

        {/* Scanning Sweep Line */}
        <motion.div
          animate={{ x: ["-10%", "110%"] }}
          transition={{ duration: 4, repeat: Infinity, ease: "linear" }}
          style={{
            position: "absolute",
            top: 0,
            bottom: 0,
            width: 2,
            background: "var(--caliper-primary)",
            boxShadow: "0 0 15px var(--caliper-primary)",
            zIndex: 10,
          }}
        />

        {/* Highlight Pulse */}
        <motion.div
          animate={{ opacity: [0, 0.5, 0] }}
          transition={{ duration: 2, repeat: Infinity, delay: 1 }}
          style={{
            position: "absolute",
            top: 40,
            left: 178,
            width: 84,
            height: 36,
            border: "2px solid var(--caliper-primary)",
            borderRadius: 6,
            zIndex: 5,
          }}
        />
      </div>
      <div className={styles.demoAgentBadge}>AGENT: SCANNING_GEOMETRY...</div>
    </div>
  );
}
