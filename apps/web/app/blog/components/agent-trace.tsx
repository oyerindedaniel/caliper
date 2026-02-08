"use client";

import { motion, AnimatePresence } from "motion/react";
import { useState, useEffect } from "react";
import styles from "../../page.module.css";

interface TraceStep {
  action: string;
  result?: string;
  thought: string;
}

interface AgentTraceProps {
  scenario: string;
  steps: TraceStep[];
}

export function AgentTrace({ steps }: AgentTraceProps) {
  const [activeStep, setActiveStep] = useState(-1);

  useEffect(() => {
    const timer = setInterval(() => {
      setActiveStep((prev) => (prev < steps.length - 1 ? prev + 1 : prev));
    }, 2000);
    return () => clearInterval(timer);
  }, [steps]);

  return (
    <div className={styles.agentTraceContainer}>
      <div className={styles.agentTraceHeader}>
        <div className={styles.statusDot} />
        <span className={styles.agentTraceTitle}>AGENT_REASONING_TRACE</span>
      </div>
      <div className={styles.agentTraceContent}>
        <AnimatePresence mode="popLayout">
          {steps.slice(0, activeStep + 1).map((step, idx) => (
            <motion.div
              key={idx}
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.4, ease: "easeOut" }}
              className={styles.traceStep}
            >
              <div className={styles.traceActionLine}>
                <span className={styles.traceAction}>{step.action}</span>
                {step.result && (
                  <>
                    <span className={styles.traceArrow}>→</span>
                    <span className={styles.traceResult}>{step.result}</span>
                  </>
                )}
              </div>
              <p className={styles.traceThought}>{step.thought}</p>
            </motion.div>
          ))}
        </AnimatePresence>
        {activeStep < steps.length - 1 && (
          <motion.div
            animate={{ opacity: [0, 1, 0] }}
            transition={{ duration: 0.8, repeat: Infinity }}
            className={styles.traceCursor}
          >
            _
          </motion.div>
        )}
      </div>
    </div>
  );
}
