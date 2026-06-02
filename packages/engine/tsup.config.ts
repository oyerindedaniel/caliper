import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/cli.ts"],
  format: ["esm"],
  dts: true,
  clean: true,
  splitting: false,
  sourcemap: true,
  treeshake: false,
  external: ["@oyerinde/caliper-schema"],
  esbuildOptions(options) {
    options.alias = {
      "@engine": "./src",
    };
  },
});
