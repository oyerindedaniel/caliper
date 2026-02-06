"use client";

import styles from "../page.module.css";
import Image from "next/image";
import { Nav } from "../components/nav";
import { Footer } from "../components/footer";

const FAQ_ITEMS = [
  {
    question: "How is Caliper different from Chrome DevTools?",
    answer: (
      <>
        Chrome DevTools is a general-purpose debugger. Caliper is specialized for design
        engineering. It provides features DevTools lacks, like simultaneous multi-element
        measurement, keyboard-driven precision, design-token awareness, and visual projection tools
        for alignment checks.
      </>
    ),
  },
  {
    question: "Does it work with my framework?",
    answer: (
      <>
        Yes. Caliper is framework-agnostic. It runs as a standalone overlay in the DOM. Whether you
        use Next.js, Vue, Svelte, or plain HTML, Caliper works the same way.
      </>
    ),
  },
  {
    question: "What is the Agent Bridge?",
    answer: (
      <>
        The <strong>Agent Bridge</strong> connects Caliper to AI coding agents like Cursor or Claude
        Code. It allows the AI to "see" your local UI, perform audits, and verify its own CSS
        changes visually, rather than just guessing based on code.
      </>
    ),
  },
  {
    question: "Is it safe for production?",
    answer: (
      <>
        Caliper is designed to be stripped out of production bundles. If you initialize it inside a{" "}
        <strong>process.env.NODE_ENV === &apos;development&apos;</strong> check (as recommended), it
        will never load in <strong>production</strong>.
      </>
    ),
  },
  {
    question: "Can I customize the colors?",
    answer: (
      <>
        Absolutely. You can override the entire color theme in the configuration object passed to{" "}
        <strong>init()</strong>. Match it to your brand or personal preference.
      </>
    ),
  },
  {
    question: "Why do use a custom MCP instead of a browser extension?",
    answer: (
      <>
        Browser extensions are sandboxed and cannot easily communicate with your local editor or
        terminal. Our MCP server bridges that gap, allowing direct, bi-directional communication
        between your AI agent and the live browser state.
      </>
    ),
  },
];

export default function FAQPage() {
  return (
    <div className={styles.page}>
      <main className={styles.main}>
        <Nav />

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
            <div key={idx} className={styles.faqItem}>
              <div className={styles.faqNumber}>{idx + 1}</div>
              <h3 className={styles.faqQuestion}>{item.question}</h3>
              <div className={styles.faqConnector} />
              <p className={styles.faqAnswer}>{item.answer}</p>
            </div>
          ))}
        </div>
      </main>
      <Footer />
    </div>
  );
}
