import { useState } from "react";
import styles from "@/app/page.module.css";
import { CodeBlock } from "./components/code-block";

type Framework = "next" | "vite" | "astro" | "nuxt" | "vue" | "tanstack" | "html";
type PackageManager = "npm" | "pnpm" | "yarn" | "bun";

interface InstallationProps {
  mode?: "core" | "agentic";
}

export function Installation({ mode = "core" }: InstallationProps) {
  const [framework, setFramework] = useState<Framework>("next");
  const [pkgManager, setPkgManager] = useState<PackageManager>("pnpm");
  const isAgentic = mode === "agentic";

  const nextCode = isAgentic
    ? `// app/layout.tsx
import Script from "next/script";

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        {process.env.NODE_ENV === "development" && (
          <Script
             src="https://unpkg.com/@oyerinde/caliper/dist/index.global.js"
             data-config={JSON.stringify({ 
               bridge: { enabled: true } 
             })}
             strategy="afterInteractive"
          />
        )}
        {children}
      </body>
    </html>
  );
}`
    : `// app/layout.tsx
import Script from "next/script";

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        {process.env.NODE_ENV === "development" && (
          <Script
             src="https://unpkg.com/@oyerinde/caliper/dist/index.global.min.js"
             data-config={JSON.stringify({ 
               theme: { primary: "#AC2323" } 
             })}
             strategy="afterInteractive"
          />
        )}
        {children}
      </body>
    </html>
  );
}`;

  const viteCode = isAgentic
    ? `// main.ts
if (import.meta.env.DEV) {
  import("@oyerinde/caliper/preset").then(({ init, CaliperBridge }) => {
    init(/* config */, [(caliper) => caliper.use(CaliperBridge({ enabled: true }))]);
  });
}`
    : `// main.ts
if (import.meta.env.DEV) {
  import("@oyerinde/caliper").then(({ init }) => init(/* config */));
}`;

  const astroCode = isAgentic
    ? `<!-- src/layouts/Layout.astro -->
<script type="module">
  if (import.meta.env.DEV) {
    import("@oyerinde/caliper/preset").then(({ init, CaliperBridge }) => {
      init(/* config */, [(caliper) => caliper.use(CaliperBridge({ enabled: true }))]);
    });
  }
</script>`
    : `<!-- src/layouts/Layout.astro -->
<html lang="en">
  <head>
    <script type="module">
      if (import.meta.env.DEV) {
        import("@oyerinde/caliper").then(({ init }) => init(/* config */));
      }
    </script>
  </head>
  ...
</html>`;

  const htmlCode = isAgentic
    ? `<!-- index.html -->
<script 
  src="https://unpkg.com/@oyerinde/caliper/dist/index.global.js"
  data-config='{ "bridge": { "enabled": true } }'
></script>`
    : `<!-- index.html -->
<script src="https://unpkg.com/@oyerinde/caliper/dist/index.global.min.js"></script>`;

  const nuxtCode = isAgentic
    ? `// plugins/caliper.client.ts
export default defineNuxtPlugin(() => {
  if (import.meta.dev) {
    import("@oyerinde/caliper/preset").then(({ init, CaliperBridge }) => {
      init(/* config */, [(caliper) => caliper.use(CaliperBridge({ enabled: true }))]);
    });
  }
});`
    : `// plugins/caliper.client.ts
export default defineNuxtPlugin(() => {
  if (import.meta.dev) {
    import("@oyerinde/caliper").then(({ init }) => init(/* config */));
  }
});`;

  const vueCode = isAgentic
    ? `// main.ts
if (import.meta.env.DEV) {
  import("@oyerinde/caliper/preset").then(({ init, CaliperBridge }) => {
    init(/* config */, [(caliper) => caliper.use(CaliperBridge({ enabled: true }))]);
  });
}`
    : `// main.ts
if (import.meta.env.DEV) {
  import("@oyerinde/caliper").then(({ init }) => init(/* config */));
}`;

  const tanstackCode = isAgentic
    ? `// src/entry-client.tsx
if (process.env.NODE_ENV === "development") {
  import("@oyerinde/caliper/preset").then(({ init, CaliperBridge }) => {
    init(/* config */, [(caliper) => caliper.use(CaliperBridge({ enabled: true }))]);
  });
}`
    : `// src/entry-client.tsx
if (process.env.NODE_ENV === "development") {
  import("@oyerinde/caliper").then(({ init }) => init(/* config */));
}`;

  const getLanguage = () => {
    switch (framework) {
      case "astro":
        return "html";
      case "vue":
      case "nuxt":
      case "vite":
      case "html":
        return "ts";
      default:
        return "tsx";
    }
  };

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
    <section id="installation" className={styles.section}>
      <h2 className={styles.sectionHeader}>Installation</h2>

      <div className="mb-32">
        <p className="mb-18 op-8">Step 1: Install the package</p>
        <div className={`${styles.tabs} flex flex-wrap gap-8 mb-12`}>
          {(["npm", "pnpm", "yarn", "bun"] as const).map((pm) => (
            <button
              key={pm}
              className={`${styles.tab} ${pkgManager === pm ? styles.activeTab : ""}`}
              onClick={() => setPkgManager(pm)}
            >
              {pm}
            </button>
          ))}
        </div>
        <div className="mb-8">
          <CodeBlock
            code={`${pkgManager} ${pkgManager === "yarn" ? "add" : "install"} @oyerinde/caliper`}
            language="bash"
          />
        </div>
        <p className="mt-8 op-5 fs-12 italic">
          * Optional if you're only using the global CDN script.
        </p>
      </div>

      <div>
        <p className="mb-18 op-8">Step 2: Initialize in your project</p>
        <div className={`${styles.tabs} flex flex-wrap gap-8`}>
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
      </div>
    </section>
  );
}
