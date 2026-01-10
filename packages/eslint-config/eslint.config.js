import js from "@eslint/js";
import eslintConfigPrettier from "eslint-config-prettier";

/** @type {import("eslint").Linter.Config[]} */
export default [
  js.configs.recommended,
  eslintConfigPrettier,
  {
    ignores: ["node_modules/**"],
  },
];
