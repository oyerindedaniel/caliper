import type { Ref } from "solid-js";

export function assignRef<T>(ref: Ref<T> | undefined, value: T): void {
  if (typeof ref === "function") {
    (ref as (element: T) => void)(value);
  }
}

export function mergeRefs<T>(...refs: (Ref<T> | undefined)[]): (value: T) => void {
  return (value) => {
    for (const ref of refs) {
      assignRef(ref, value);
    }
  };
}
