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
  env: {
    NODE_ENV: process.env.NODE_ENV ?? "development",
    VERSION: version,
  },
  external: [],
  noExternal: ["solid-js", "@caliper/core", "@caliper/overlay"],
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
  const isProd = process.env.NODE_ENV === "production";
  const watch =
    !isProd && options.watch ? ["src/**/*", "../overlay/src/**/*", "../core/src/**/*"] : false;

  return [
    {
      ...DEFAULT_OPTIONS,
      entry: { index: "./src/auto.ts" },
      format: ["iife"],
      globalName: "Caliper",
      platform: "browser",
      esbuildPlugins: getEsbuildPlugins(),
      watch,
    },
    {
      ...DEFAULT_OPTIONS,
      entry: {
        index: "./src/index.ts",
        core: "../core/src/index.ts",
      },
      format: ["cjs", "esm"],
      platform: "browser",
      splitting: true,
      esbuildPlugins: getEsbuildPlugins(),
      watch,
    },
    {
      ...DEFAULT_OPTIONS,
      entry: { "index.server": "./src/index.server.ts" },
      format: ["cjs", "esm"],
      platform: "node",
      noExternal: [],
      external: ["solid-js", "@caliper/core", "@caliper/overlay"],
      esbuildPlugins: [],
      dts: false,
      watch,
    },
  ] as Options[];
});
