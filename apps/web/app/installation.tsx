import { useState } from "react";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { vscDarkPlus } from "react-syntax-highlighter/dist/esm/styles/prism";
import styles from "./page.module.css";

type Framework = "next" | "vite" | "astro" | "nuxt" | "vue" | "tanstack";

export function Installation() {
  const [framework, setFramework] = useState<Framework>("next");

  const nextCode = `// app/layout.tsx (or _document.tsx)
import Script from "next/script";

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        {process.env.NODE_ENV === "development" && (
          <Script
             src="https://unpkg.com/@aspect/caliper/dist/index.global.js"
             data-config={JSON.stringify({ theme: { primary: '#AC2323' } })}
             strategy="afterInteractive"
          />
        )}
        {children}
      </body>
    </html>
  );
}`;

  const viteCode = `<!-- index.html -->
<script type="module">
  import { init } from "https://unpkg.com/@aspect/caliper/dist/index.js";
  
  if (import.meta.env.DEV) {
    init({ theme: { primary: '#AC2323' } }).mount();
  }
</script>`;

  const astroCode = `// src/components/Caliper.astro
<script type="module">
  import { init } from "@aspect/caliper";
  
  if (import.meta.env.DEV) {
    init().mount();
  }
</script>

<!-- Add <Caliper /> to your Layout.astro -->`;

  const nuxtCode = `// nuxt.config.ts
export default defineNuxtConfig({
  app: {
    head: {
      script: [
        {
          src: 'https://unpkg.com/@aspect/caliper/dist/index.global.js',
          'data-config': JSON.stringify({ theme: { primary: '#AC2323' } }),
          defer: true
        }
      ]
    }
  }
});`;

  const vueCode = `<!-- index.html -->
<script type="module">
  // In Vue 3 + Vite, you can import directly in index.html
  // and use import.meta.env.DEV to guard it.
  import { init } from "https://unpkg.com/@aspect/caliper/dist/index.js";
  
  if (import.meta.env.DEV) {
    init().mount();
  }
</script>`;

  const tanstackCode = `// root.tsx (TanStack Start)
import { Meta, Scripts } from '@tanstack/react-router';

export function Root() {
  return (
    <html lang="en">
      <head>
        <Meta />
        {process.env.NODE_ENV === 'development' && (
          <script
            src="https://unpkg.com/@aspect/caliper/dist/index.global.js"
            data-config={JSON.stringify({ theme: { primary: '#AC2323' } })}
            async
          />
        )}
      </head>
      <body>
        {/* ... */}
        <Scripts />
      </body>
    </html>
  );
}`;

  const getCode = () => {
    switch (framework) {
      case "next": return nextCode;
      case "astro": return astroCode;
      case "nuxt": return nuxtCode;
      case "vue": return vueCode;
      case "tanstack": return tanstackCode;
      default: return viteCode;
    }
  };

  return (
    <>
      <h2 className={styles.sectionHeader}>
        Installation
      </h2>
      <div className={styles.tabs} style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
        <button
          className={`${styles.tab} ${framework === "next" ? styles.activeTab : ""}`}
          onClick={() => setFramework("next")}
          style={{ width: "auto" }}
        >
          Next.js
        </button>
        <button
          className={`${styles.tab} ${framework === "vite" ? styles.activeTab : ""}`}
          onClick={() => setFramework("vite")}
          style={{ width: "auto" }}
        >
          Vite / HTML
        </button>
        <button
          className={`${styles.tab} ${framework === "astro" ? styles.activeTab : ""}`}
          onClick={() => setFramework("astro")}
          style={{ width: "auto" }}
        >
          Astro
        </button>
        <button
          className={`${styles.tab} ${framework === "nuxt" ? styles.activeTab : ""}`}
          onClick={() => setFramework("nuxt")}
          style={{ width: "auto" }}
        >
          Nuxt
        </button>
        <button
          className={`${styles.tab} ${framework === "vue" ? styles.activeTab : ""}`}
          onClick={() => setFramework("vue")}
          style={{ width: "auto" }}
        >
          Vue
        </button>
        <button
          className={`${styles.tab} ${framework === "tanstack" ? styles.activeTab : ""}`}
          onClick={() => setFramework("tanstack")}
          style={{ width: "auto" }}
        >
          TanStack Start
        </button>
      </div>

      <div className={styles.codeBlock} suppressHydrationWarning>
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
          {getCode()}
        </SyntaxHighlighter>
      </div>
    </>
  );
}
