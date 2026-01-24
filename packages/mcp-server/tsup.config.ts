import fs from "node:fs";
import { defineConfig } from "tsup";

const getPackageVersion = (): string => {
  try {
    return (JSON.parse(fs.readFileSync("package.json", "utf8")) as { version: string }).version;
  } catch (_) {
    return "0.0.0";
  }
};

const version = process.env.NODE_ENV === "production" ? getPackageVersion() : "[DEV]";

const banner = `/**
 * @name @oyerinde/caliper-mcp
 * @author Daniel Oyerinde
 * @license MIT
 *
 * Caliper - Browser Measurement Tool (MCP Server)
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */`;

export default defineConfig({
  banner: {
    js: banner,
  },
  entry: ["src/index.ts"],
  format: ["esm", "cjs"],
  dts: false,
  clean: true,
  shims: true,
  external: [],
  noExternal: ["@oyerinde/caliper-schema"],
  env: {
    NODE_ENV: process.env.NODE_ENV ?? "development",
    VERSION: version,
  },
});
