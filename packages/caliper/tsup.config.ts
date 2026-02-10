import fs from "node:fs";
import { defineConfig, type Options } from "tsup";
// @ts-expect-error -- esbuild-plugin-babel is not typed
import babel from "esbuild-plugin-babel";

const getPackageVersion = (): string => {
  try {
    return (JSON.parse(fs.readFileSync("package.json", "utf8")) as { version: string }).version;
  } catch (_) {
    return "0.0.0";
  }
};

const version = process.env.NODE_ENV === "production" ? getPackageVersion() : "[DEV]";

const banner = `/**
 * @name @oyerinde/caliper
 * @author Daniel Oyerinde
 * @license MIT
 *
 * Caliper - Browser Measurement Tool
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */`;

const DEFAULT_OPTIONS: Options = {
  banner: {
    js: banner,
  },
  clean: false,
  dts: true,
  entry: ["./src/index.ts"],
  define: {
    "process.env.VERSION": JSON.stringify(version),
  },
  external: [],
  noExternal: ["solid-js", "@caliper/core", "@caliper/overlay", "@oyerinde/caliper-bridge"],
  outDir: "./dist",
  sourcemap: false,
  splitting: false,
  target: "esnext",
  treeshake: true,
};

const getEsbuildPlugins = () => [
  // eslint-disable-next-line @typescript-eslint/no-unsafe-call
  babel({
    filter: /\.(tsx|jsx)$/,
    config: {
      presets: [
        ["@babel/preset-typescript", { onlyRemoveTypeImports: true }],
        "babel-preset-solid",
      ],
    },
  }),
];

export default defineConfig((options) => {
  return [
    {
      ...DEFAULT_OPTIONS,
      entry: { index: "./src/auto.ts" },
      format: ["iife"],
      globalName: "Caliper",
      minify: true,
      platform: "browser",
      define: {
        ...DEFAULT_OPTIONS.define,
        "process.env.NODE_ENV": JSON.stringify(process.env.NODE_ENV ?? "development"),
      },
      esbuildPlugins: getEsbuildPlugins(),
      dts: false,
    },
    {
      ...DEFAULT_OPTIONS,
      entry: { "index.global.min": "./src/auto-lite.ts" },
      format: ["iife"],
      globalName: "Caliper",
      minify: true,
      platform: "browser",
      define: {
        ...DEFAULT_OPTIONS.define,
        "process.env.NODE_ENV": JSON.stringify(process.env.NODE_ENV ?? "development"),
      },
      esbuildPlugins: getEsbuildPlugins(),
      dts: false,
      outExtension({ format }) {
        return {
          js: `.js`,
        };
      },
    },
    {
      ...DEFAULT_OPTIONS,
      entry: {
        index: "./src/index.ts",
        preset: "./src/preset.ts",
        bridge: "./src/bridge.ts",
      },
      format: ["cjs", "esm"],
      platform: "browser",
      splitting: true,
    },
    {
      ...DEFAULT_OPTIONS,
      entry: {
        mcp: "./src/mcp.ts",
      },
      format: ["esm", "cjs"],
      platform: "node",
      noExternal: ["@modelcontextprotocol/sdk", "ws", "@oyerinde/caliper-schema", "@caliper/core"],
      external: ["zod"],
      dts: false,
      shims: false,
      minify: true,
      banner: {
        js: "#!/usr/bin/env node\n" + banner,
      },
      esbuildPlugins: [],
    },
    {
      ...DEFAULT_OPTIONS,
      entry: {
        "index.server": "./src/index.server.ts",
        "bridge.server": "./src/bridge.server.ts",
        "preset.server": "./src/preset.server.ts",
      },
      format: ["cjs", "esm"],
      platform: "node",
      noExternal: [],
      external: [],
      esbuildPlugins: [],
      dts: false,
    },
  ] as Options[];
});
