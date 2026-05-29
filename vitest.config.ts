import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, defineProject } from "vitest/config";

const rootDir = path.dirname(fileURLToPath(import.meta.url));
const coreSrc = path.resolve(rootDir, "packages/core/src");

export default defineConfig({
  test: {
    projects: [
      defineProject({
        resolve: {
          alias: {
            "@": coreSrc,
          },
        },
        test: {
          name: "jsdom",
          include: ["packages/agent-bridge/**/*.test.ts", "packages/core/**/*.test.ts"],
          environment: "jsdom",
        },
      }),
      defineProject({
        test: {
          name: "node",
          include: ["packages/mcp-server/**/*.test.ts", "packages/schema/**/*.test.ts"],
          environment: "node",
        },
      }),
    ],
    globals: true,
  },
});
