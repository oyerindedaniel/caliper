export const getNormalizedModifiers = (e: MouseEvent | PointerEvent | KeyboardEvent) => {
  const isAltGraph = e.getModifierState?.("AltGraph");
  return {
    Control: isAltGraph ? false : e.ctrlKey,
    Meta: e.metaKey,
    Alt: isAltGraph || e.altKey,
    Shift: e.shiftKey,
  };
};

export const getLogicalKey = (e: KeyboardEvent) => {
  // Ignore fake Control events sent by AltGraph on Windows
  if (e.key === "Control" && e.getModifierState?.("AltGraph")) return "";
  if (e.key === "AltGraph") return "Alt";
  return e.key;
};

export const isKeyMatch = (target: string, e: KeyboardEvent) => {
  return getLogicalKey(e) === target;
};
