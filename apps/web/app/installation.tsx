import { useState } from "react";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { vscDarkPlus } from "react-syntax-highlighter/dist/esm/styles/prism";
import styles from "./page.module.css";

type Framework = "next" | "vite";

export function Installation() {
  const [framework, setFramework] = useState<Framework>("next");

  const nextCode = `// app/layout.tsx
import Script from "next/script";

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        {process.env.NODE_ENV === "development" && (
          <Script
            src="https://unpkg.com/@caliper/overlay/dist/index.js"
            crossOrigin="anonymous"
            strategy="beforeInteractive"
          />
        )}
        {children}
      </body>
    </html>
  );
}`;

  const viteCode = `// main.tsx
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'

// Only invoke in development
if (import.meta.env.DEV) {
  import("@caliper/overlay")
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)`;

  return (
    <>
      <h2 className={styles.sectionHeader}>
        Installation
      </h2>
      <div className={styles.tabs}>
        <button
          className={`${styles.tab} ${framework === "next" ? styles.activeTab : ""}`}
          onClick={() => setFramework("next")}
        >
          Next.js
        </button>
        <button
          className={`${styles.tab} ${framework === "vite" ? styles.activeTab : ""}`}
          onClick={() => setFramework("vite")}
        >
          Vite
        </button>
      </div>

      <div className={styles.codeBlock}>
        <SyntaxHighlighter
          language="tsx"
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
          }}
        >
          {framework === "next" ? nextCode : viteCode}
        </SyntaxHighlighter>
      </div>
    </>
  );
}
