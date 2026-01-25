import { RUNTIME_CLASS_IGNORE_PREFIXES } from "../constants/index.js";

export function filterRuntimeClasses(classes: string[] | DOMTokenList): string[] {
    const list = Array.from(classes);
    return list.filter((className) => {
        // 1. Check known prefixes (is-, has-, caliper-, etc.)
        if (RUNTIME_CLASS_IGNORE_PREFIXES.some((prefix) => className.startsWith(prefix))) {
            return false;
        }

        // 2. CSS Modules Detection (e.g. page-module__...)
        if (className.includes("-module") || className.includes("_module")) {
            return false;
        }

        // 3. Hashed/Generated patterns
        // Detects patterns like __a1b2c or --x9y8z (common in generated CSS)
        // If it contains a double separator and a segment with digits, it's likely unstable.
        if ((className.includes("__") || className.includes("--")) && /[0-9]/.test(className)) {
            return false;
        }

        return true;
    });
}
