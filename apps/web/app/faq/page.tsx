"use client";

import styles from "@/app/page.module.css";
import Image from "next/image";
import { useCopy } from "@/app/hooks/use-copy";

interface FAQItem {
  question: string;
  answer: React.ReactNode;
  prompt?: string;
}

const FAQ_ITEMS: FAQItem[] = [
  {
    question: "How is Caliper different from Chrome DevTools?",
    answer: (
      <>
        Specialized for design engineering. Unlike DevTools, it handles simultaneous multi-element
        measurement, keyboard-driven precision, and visual projection tools for layout alignment.
      </>
    ),
    prompt:
      "Referencing https://caliper.danieloyerinde.com, explain how Caliper's multi-element measurement and visual projection tools solve design engineering problems that standard Chrome DevTools cannot.",
  },
  {
    question: "Does it work with my framework?",
    answer: (
      <>
        Yes. Caliper is framework-agnostic. It runs as a standalone DOM overlay, fully compatible
        with Next.js, Vite, Astro, Nuxt, Vue, and plain HTML.
      </>
    ),
    prompt:
      "Referencing https://caliper.danieloyerinde.com, how does Caliper's framework-agnostic DOM overlay approach ensure it works across Next.js, Vite, and Astro without specific plugins?",
  },
  {
    question: "What is the Agent Bridge?",
    answer: (
      <>
        A high-speed link that exposes your local browser state to AI agents. It enables AI to
        visually audit your UI instead of guessing from code.
      </>
    ),
    prompt:
      "Referencing https://caliper.danieloyerinde.com and https://caliper.danieloyerinde.com/docs/agentic, describe the architecture of Caliper's Agent Bridge and how it enables AI agents to perform visual UI audits of local development states.",
  },
  {
    question: "Does it work if I have multiple tabs open?",
    answer: (
      <>
        Gracefully. Each tab is assigned a unique session ID. Caliper tracks focus and only syncs
        the active tab’s state to your agent.
      </>
    ),
  },
  {
    question: "Is it safe for production?",
    answer: (
      <>
        Yes. When initialized inside a development check (e.g.,{" "}
        <strong>process.env.NODE_ENV === &apos;development&apos;</strong>), it is completely
        stripped from production bundles.
      </>
    ),
    prompt:
      "Referencing https://caliper.danieloyerinde.com, what are the best practices for ensuring Caliper's library and bridge code are entirely removed from production build bundles?",
  },
  {
    question: "My AI Agent can't connect. What should I check?",
    answer: (
      <>
        Usually a port conflict. Ensure the bridge port is not being used by another process and
        verify the MCP relay is running in your terminal.
      </>
    ),
    prompt:
      "Referencing https://caliper.danieloyerinde.com and https://caliper.danieloyerinde.com/docs/agentic, my AI Agent cannot connect to the Caliper Bridge. Can you provide a guide on how to identify which process (PID) is claiming my configured WebSocket port on my operating system so I can resolve the conflict?",
  },
  {
    question: "Where does my data go?",
    answer: (
      <>
        <strong>Nowhere.</strong> All processing is local. No UI data, source code, or telemetry is
        transmitted to external servers. Your privacy is a priority.
      </>
    ),
  },
  {
    question: "Can I customize the overlay?",
    answer: (
      <>
        Yes. Pass a configuration object to <strong>init()</strong> to override the default theme
        (colors) or command shortcuts (keys) to match your personal preference or brand.
      </>
    ),
    prompt:
      "Referencing https://caliper.danieloyerinde.com, how can I programmatically customize Caliper's overlay colors and command shortcuts to match my project's design system?",
  },
  {
    question: "Why do you use a custom MCP instead of a browser extension?",
    answer: (
      <>
        Extensions are sandboxed. Our MCP relay allows the AI agent to communicate directly with the
        browser&apos;s live layout engine without sandbox restrictions.
      </>
    ),
  },
];

export default function FAQPage() {
  return (
    <>
      <div className="flex flex-col gap-12 mb-24">
        <div className={styles.logoWrapper}>
          <Image
            src="/caliper_logo.svg"
            alt="Caliper logo"
            width={172}
            height={50}
            className="h-auto"
            priority
            unoptimized
          />
        </div>

        <div>
          <h1 className="sr-only">FAQ</h1>
          <p className="op-8">
            Common questions about integration, features, and the philosophy behind precision
            tooling.
          </p>
        </div>
      </div>

      <div className={styles.faqList}>
        {FAQ_ITEMS.map((item, idx) => (
          <FAQRow key={idx} item={item} index={idx} />
        ))}
      </div>
    </>
  );
}

function FAQRow({ item, index }: { item: FAQItem; index: number }) {
  const { copied, copy } = useCopy();

  return (
    <div className={styles.faqItem}>
      <div className={styles.faqNumber}>{index + 1}</div>
      <div className={`${styles.faqQuestion} flex items-start justify-between gap-16`}>
        <h3 className="flex-1 m-0">{item.question}</h3>
        {item.prompt && (
          <button
            onClick={() => copy(item.prompt!)}
            className={`${styles.copyPromptButton} ${copied ? styles.copyPromptButtonActive : ""}`}
            title="Copy prompt for AI agent"
          >
            <span className="material-symbols-outlined fs-14">
              {copied ? "check_circle" : "content_copy"}
            </span>
            <span className={styles.copyPromptText}>
              {copied ? "Copied Prompt" : "Copy Prompt"}
            </span>
          </button>
        )}
      </div>
      <div className={styles.faqConnector} />
      <p className={styles.faqAnswer}>{item.answer}</p>
    </div>
  );
}
