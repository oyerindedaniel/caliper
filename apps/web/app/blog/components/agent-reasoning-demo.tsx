"use client";

import { motion, AnimatePresence } from "motion/react";
import { useState, useEffect } from "react";
import styles from "@/app/page.module.css";

const PROCEDURE_STEPS = [
  {
    label: "ACQUIRING_CONTEXT",
    detail: "Locating Node[caliper-0x4f] at [332, 243]",
    color: "var(--caliper-primary)",
  },
  {
    label: "OBSERVING_GEOMETRY",
    detail: "BBox: { w: 600, h: 320 } | Z: -1",
    color: "var(--caliper-secondary)",
  },
  {
    label: "VERIFYING_OUTCOME",
    detail: "Delta identified: +0.2px subpixel shift",
    color: "var(--caliper-projection)",
  },
];

export function AgentReasoningDemo() {
  const [step, setStep] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => {
      setStep((step) => (step + 1) % PROCEDURE_STEPS.length);
    }, 3000);
    return () => clearInterval(timer);
  }, []);

  const currentStep = PROCEDURE_STEPS[step];
  if (!currentStep) return null;

  return (
    <div className={styles.demoContainer}>
      <div className={styles.demoStage}>
        <div
          style={{
            width: 240,
            height: 140,
            border: `1px solid ${currentStep.color}`,
            background: "rgba(255, 255, 255, 0.02)",
            position: "relative",
            display: "flex",
            flexDirection: "column",
            gap: 12,
            padding: 24,
            transition: "border-color 0.5s ease",
            borderRadius: 4,
          }}
        >

          <div
            style={{
              position: "absolute",
              top: -1,
              left: 40,
              width: 1,
              height: "calc(100% + 2px)",
              background: currentStep.color,
              opacity: 0.2,
            }}
          />
          <div
            style={{
              position: "absolute",
              left: -1,
              top: 40,
              height: 1,
              width: "calc(100% + 2px)",
              background: currentStep.color,
              opacity: 0.2,
            }}
          />

          <motion.div
            key={step + "label"}
            initial={{ opacity: 0, x: -5 }}
            animate={{ opacity: 1, x: 0 }}
            style={{
              fontFamily: "var(--font-geist-mono)",
              fontSize: 10,
              color: currentStep.color,
              letterSpacing: "0.1em",
              fontWeight: 700,
            }}
          >
            {currentStep.label}
          </motion.div>

          <motion.div
            key={step + "detail"}
            initial={{ opacity: 0 }}
            animate={{ opacity: 0.6 }}
            style={{
              fontFamily: "var(--font-geist-mono)",
              fontSize: 11,
              color: "white",
              lineHeight: 1.4,
            }}
          >
            {currentStep.detail}
          </motion.div>

          <AnimatePresence mode="wait">
            {step === 1 && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                style={{
                  position: "absolute",
                  bottom: -20,
                  right: -20,
                  fontFamily: "var(--font-geist-mono)",
                  fontSize: 10,
                  color: "var(--caliper-secondary)",
                  background: "rgba(242, 78, 30, 0.1)",
                  padding: "4px 8px",
                  border: "1px solid var(--caliper-secondary)",
                  borderRadius: 2,
                }}
              >
                COMPUTING_VIEWPORT_RECT...
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <motion.div
          animate={{ x: ["-10%", "110%"] }}
          transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
          style={{
            position: "absolute",
            top: 0,
            bottom: 0,
            width: 1,
            background: currentStep.color,
            boxShadow: `0 0 20px ${currentStep.color}`,
            zIndex: 10,
            opacity: 0.7,
          }}
        />
      </div>
      <div
        className={styles.demoAgentBadge}
        style={{ color: currentStep.color }}
      >
        PROCEDURE: {currentStep.label}
      </div>
    </div>
  );
}
