"use client";

import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { vscDarkPlus } from "react-syntax-highlighter/dist/esm/styles/prism";
import { useCopy } from "@/app/hooks/use-copy";
import styles from "@/app/page.module.css";

interface CodeBlockProps {
  code: string;
  language?: string;
}

export function CodeBlock({ code, language = "tsx" }: CodeBlockProps) {
  const { copied, copy } = useCopy();

  return (
    <div className={styles.codeBlock} style={{ position: "relative" }}>
      <button
        onClick={() => copy(code)}
        className={styles.copyCodeButton}
        style={{
          background: copied ? "#10b981" : "rgba(255, 255, 255, 0.1)",
        }}
      >
        {copied ? "COPIED" : "COPY"}
      </button>
      <SyntaxHighlighter
        language={language}
        style={vscDarkPlus}
        useInlineStyles={true}
        codeTagProps={{
          style: {
            background: "none",
            padding: 0,
          },
        }}
        customStyle={{
          margin: 0,
          borderRadius: "0 0 8px 8px",
          fontSize: "13px",
          fontFamily: "var(--font-geist-mono)",
          background: "transparent",
          padding: "20px",
          overflowX: "auto",
        }}
      >
        {code}
      </SyntaxHighlighter>
    </div>
  );
}
