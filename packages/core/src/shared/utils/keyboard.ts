export const getNormalizedModifiers = (e: MouseEvent | PointerEvent | KeyboardEvent) => {
  const isAltGraph = e.getModifierState?.("AltGraph");
  return {
    Control: isAltGraph ? false : e.ctrlKey,
    Meta: e.metaKey,
    Alt: isAltGraph || e.altKey,
    Shift: e.shiftKey,
  };
};

/**
 * Resolves the logical key name for a KeyboardEvent, accounting for 
 * platform-specific quirks (like Windows AltGraph behavior).
 * 
 * @param e - The keyboard event to analyze.
 * @returns The normalized key name.
 */
export const getLogicalKey = (e: KeyboardEvent) => {
  // Ignore fake Control events sent by AltGraph on Windows
  if (e.key === "Control" && e.getModifierState?.("AltGraph")) return "";
  if (e.key === "AltGraph") return "Alt";
  return e.key;
};

/**
 * Checks if the logical key of an event matches a target key string.
 * 
 * @param target - The key name to match against.
 * @param e - The keyboard event.
 * @returns True if the key matches.
 */
export const isKeyMatch = (target: string, e: KeyboardEvent) => {
  return getLogicalKey(e) === target;
};
