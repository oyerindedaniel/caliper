import { RUNTIME_CLASS_IGNORE_PREFIXES } from "../constants/index.js";

/**
 * Filters out ephemeral CSS classes that are used for runtime state tracking.
 * 
 * @param classes - An array or DOMTokenList of class names.
 * @returns A filtered array of stable class names.
 */
export function filterRuntimeClasses(classes: string[] | DOMTokenList): string[] {
  const list = Array.from(classes);
  return list.filter((className) => {
    // 1. Check known ephemeral prefixes
    // We keep stable prefixes even if they look generated.
    // Ephemeral prefixes are strictly for runtime state (is-active, caliper-measure, etc.)
    if (RUNTIME_CLASS_IGNORE_PREFIXES.some((prefix) => className.startsWith(prefix))) {
      return false;
    }

    // We specifically WANT CSS Modules and Hashed classes now because they are
    // useful for stable reconciliation during HMR design sessions.

    return true;
  });
}
