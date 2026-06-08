export type PresenceDataState = "open" | "closed";

/** Whether the node should remain in the DOM (mounted or exit animation in flight). */
export function shouldPresenceMount(present: boolean, unmountSuspended: boolean): boolean {
  return present || unmountSuspended;
}

function escapeCssIdentifier(value: string): string {
  if (typeof CSS !== "undefined" && "escape" in CSS) {
    return CSS.escape(value);
  }
  return value.replace(/[^a-zA-Z0-9_-]/g, "\\$&");
}

export function wirePresenceExit(
  node: HTMLElement,
  dataState: PresenceDataState,
  onExitComplete: () => void
): () => void {
  if (dataState === "open") {
    return () => {};
  }

  const style = getComputedStyle(node);
  const animationName = style.animationName;
  if (!animationName || animationName === "none") {
    const id = requestAnimationFrame(onExitComplete);
    return () => cancelAnimationFrame(id);
  }

  const handler = (event: AnimationEvent) => {
    if (event.target !== node) {
      return;
    }
    const currentName = getComputedStyle(node).animationName;
    if (!currentName || currentName === "none") {
      onExitComplete();
      return;
    }
    const escaped = escapeCssIdentifier(event.animationName);
    if (currentName.includes(escaped)) {
      node.style.animationFillMode = "forwards";
      onExitComplete();
    }
  };

  node.addEventListener("animationend", handler);
  return () => node.removeEventListener("animationend", handler);
}
