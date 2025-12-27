
import fs from "node:fs";
import { defineConfig, type Options } from "tsup";
// @ts-expect-error -- esbuild-plugin-babel is not typed
import babel from "esbuild-plugin-babel";

const getPackageVersion = (): string => {
    try {
        return (JSON.parse(fs.readFileSync("package.json", "utf8")) as { version: string })
            .version;
    } catch (_) {
        return "0.0.0";
    }
};

const version = process.env.NODE_ENV === "production"
    ? getPackageVersion()
    : "[DEV]";

const banner = `/**
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
    loader: {
        ".css": "text",
    },
    noExternal: ["solid-js", "@caliper/core", "@caliper/overlay"],
    outDir: "./dist",
    sourcemap: false,
    splitting: false,
    target: "esnext",
    treeshake: true,
    watch: ["src", "../overlay/src", "../core/src"],
};

const esbuildPlugins = [
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

export default defineConfig([
    {
        ...DEFAULT_OPTIONS,
        format: ["iife"],
        globalName: "Caliper",
        platform: "browser",
        esbuildPlugins,
    },
    {
        ...DEFAULT_OPTIONS,
        format: ["cjs", "esm"],
        platform: "neutral",
        splitting: true,
        esbuildPlugins,
    },
]);
