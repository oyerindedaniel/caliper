import { defineConfig } from "tsup";

export default defineConfig([
  // Browser build
  {
    entry: ["src/index.ts"],
    format: ["esm", "cjs"],
    dts: true,
    splitting: false,
    sourcemap: true,
    clean: true,
    outDir: "dist",
    external: ["@oyerinde/caliper"],
    platform: "browser",
    target: "es2022",
  },
  // Server stub (no-op for SSR)
  {
    entry: { "index.server": "src/index.server.ts" },
    format: ["esm", "cjs"],
    dts: false,
    splitting: false,
    sourcemap: false,
    outDir: "dist",
    platform: "node",
    target: "node18",
  },
]);
