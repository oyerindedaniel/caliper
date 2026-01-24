import fs from "node:fs";
import { defineConfig, type Options } from "tsup";

const getPackageVersion = (): string => {
  try {
    return (JSON.parse(fs.readFileSync("package.json", "utf8")) as { version: string }).version;
  } catch (_) {
    return "0.0.0";
  }
};

const version = process.env.NODE_ENV === "production" ? getPackageVersion() : "[DEV]";

const banner = `/**
 * @name @oyerinde/caliper-bridge
 * @author Daniel Oyerinde
 * @license MIT
 *
 * Caliper - Browser Measurement Tool (Agent Bridge)
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */`;

const DEFAULT_OPTIONS: Options = {
  banner: {
    js: banner,
  },
  env: {
    NODE_ENV: process.env.NODE_ENV ?? "development",
    VERSION: version,
  },
  splitting: false,
  sourcemap: true,
  clean: true,
  outDir: "dist",
};

export default defineConfig([
  // Browser build
  {
    ...DEFAULT_OPTIONS,
    entry: ["src/index.ts"],
    format: ["esm", "cjs"],
    dts: true,
    external: ["@oyerinde/caliper"],
    noExternal: ["@oyerinde/caliper-schema"],
    platform: "browser",
    target: "es2022",
  },
  // Server stub (no-op for SSR)
  {
    ...DEFAULT_OPTIONS,
    entry: { "index.server": "src/index.server.ts" },
    format: ["esm", "cjs"],
    dts: false,
    sourcemap: false,
    platform: "node",
    target: "node18",
  },
]);
