import { RUNTIME_CLASS_IGNORE_PREFIXES } from "../constants/index.js";

export function filterRuntimeClasses(classes: string[] | DOMTokenList): string[] {
    const list = Array.from(classes);
    return list.filter((className) => {
        return !RUNTIME_CLASS_IGNORE_PREFIXES.some((prefix) => className.startsWith(prefix));
    });
}
