import { defineConfig } from "tsup";
// @ts-expect-error -- esbuild-plugin-babel is not typed
import babel from "esbuild-plugin-babel";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  dts: true,
  clean: true,
  external: ["solid-js", "@caliper/core"],
  esbuildPlugins: [
    babel({
      filter: /\.(tsx|jsx)$/,
      config: {
        presets: [
          ["@babel/preset-typescript", { onlyRemoveTypeImports: true }],
          "babel-preset-solid",
        ],
      },
    }),
  ],
});
