import typescript from "@rollup/plugin-typescript";
import { nodeResolve } from "@rollup/plugin-node-resolve";
import babel from "@rollup/plugin-babel";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const packageJson = JSON.parse(
  readFileSync(join(__dirname, "package.json"), "utf-8")
);
const version = packageJson.version || "0.0.0";

export default {
  input: "src/index.ts",
  output: {
    file: "dist/index.js",
    format: "es",
    sourcemap: true,
  },
  plugins: [
    nodeResolve({
      preferBuiltins: false,
      extensions: [".js", ".jsx", ".ts", ".tsx"],
    }),
    typescript({
      tsconfig: "./tsconfig.json",
      declaration: true,
      declarationDir: "./dist",
      jsx: "preserve",
      include: ["src/**/*"],
    }),
    babel({
      babelHelpers: "bundled",
      extensions: [".ts", ".tsx"],
      exclude: "node_modules/**",
      presets: [
        ["babel-preset-solid", { generate: "dom", hydratable: false }],
        ["@babel/preset-typescript", { jsx: "preserve" }],
      ],
    }),
    {
      name: "replace-version",
      transform(code, id) {
        if (id.endsWith("index.ts") && !id.includes("node_modules")) {
          return code.replace(
            /const VERSION = "[^"]+";/g,
            `const VERSION = "${version}";`
          );
        }
      },
    },
  ],
  external: ["solid-js", "@caliper/core"],
};
