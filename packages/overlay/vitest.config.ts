import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import solid from "vite-plugin-solid";

const dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [solid({ hot: false })],
  resolve: {
    alias: {
      "@": path.resolve(dirname, "./src"),
    },
    conditions: ["development", "browser"],
  },
  ssr: {
    resolve: {
      conditions: ["browser"],
    },
  },
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    globals: true,
    server: {
      deps: {
        inline: ["solid-js", "@solidjs/testing-library"],
      },
    },
  },
});
