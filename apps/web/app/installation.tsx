import { useState } from "react";
import styles from "./page.module.css";
import { CodeBlock } from "./components/code-block";

type Framework = "next" | "vite" | "astro" | "nuxt" | "vue" | "tanstack" | "html";

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
               src="https://unpkg.com/@oyerinde/caliper/dist/index.global.js"
               data-config={JSON.stringify({ theme: { primary: '#AC2323' } })}
               strategy="afterInteractive"
            />
        )}
        {children}
      </body>
    </html>
  );
}`;

  const viteCode = `// index.html
<script type="module">
if (import.meta.env.DEV) {
  // Run npm i @oyerinde/caliper then
  import("@oyerinde/caliper").then(({ init }) => {
    init({ theme: { primary: '#AC2323' } });
  });
}
</script>`;

  const astroCode = `// src/components/Caliper.astro
<script type="module" is:inline>
  if (import.meta.env.DEV) {
    // Run npm i @oyerinde/caliper then
    import('@oyerinde/caliper').then(({ init }) => {
      init();
    });
  }
</script>

// Add <Caliper /> to your Layout.astro`;

  const htmlCode = `// index.html
<script type="module">
  const isDev = location.hostname === "localhost" || location.hostname === "127.0.0.1";

  if (isDev) {
    import("https://unpkg.com/@oyerinde/caliper/dist/index.js").then(({ init }) => {
      init({ theme: { primary: "#AC2323" } });
    });
  }
</script>`;

  const nuxtCode = `// nuxt.config.ts
export default defineNuxtConfig({
  app: {
    head: {
      script: [
        {
          src: 'https://unpkg.com/@oyerinde/caliper/dist/index.global.js',
          'data-config': JSON.stringify({ theme: { primary: '#AC2323' } }),
          defer: true
        }
      ]
    }
  }
});`;

  const vueCode = `// index.html
<script type="module">
  if (import.meta.env.DEV) {
    // Run npm i @oyerinde/caliper then
    import("@oyerinde/caliper").then(({ init }) => {
      init({ theme: { primary: '#AC2323' } });
    });
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
              src="https://unpkg.com/@oyerinde/caliper/dist/index.global.js"
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

  const getLanguage = () => "tsx";

  const getCode = () => {
    switch (framework) {
      case "next":
        return nextCode;
      case "astro":
        return astroCode;
      case "nuxt":
        return nuxtCode;
      case "vue":
        return vueCode;
      case "tanstack":
        return tanstackCode;
      case "html":
        return htmlCode;
      default:
        return viteCode;
    }
  };

  return (
    <section className={styles.section}>
      <h2 className={styles.sectionHeader}>Installation</h2>
      <div className={styles.tabs} style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
        <button
          className={`${styles.tab} ${framework === "next" ? styles.activeTab : ""}`}
          onClick={() => setFramework("next")}
        >
          Next.js
        </button>
        <button
          className={`${styles.tab} ${framework === "astro" ? styles.activeTab : ""}`}
          onClick={() => setFramework("astro")}
        >
          Astro
        </button>
        <button
          className={`${styles.tab} ${framework === "vue" ? styles.activeTab : ""}`}
          onClick={() => setFramework("vue")}
        >
          Vue
        </button>
        <button
          className={`${styles.tab} ${framework === "nuxt" ? styles.activeTab : ""}`}
          onClick={() => setFramework("nuxt")}
        >
          Nuxt
        </button>
        <button
          className={`${styles.tab} ${framework === "tanstack" ? styles.activeTab : ""}`}
          onClick={() => setFramework("tanstack")}
        >
          TanStack Start
        </button>
        <button
          className={`${styles.tab} ${framework === "vite" ? styles.activeTab : ""}`}
          onClick={() => setFramework("vite")}
        >
          Vite
        </button>
        <button
          className={`${styles.tab} ${framework === "html" ? styles.activeTab : ""}`}
          onClick={() => setFramework("html")}
        >
          HTML
        </button>
      </div>

      <CodeBlock code={getCode()} language={getLanguage()} />
    </section>
  );
}
