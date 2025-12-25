import { PREFIX } from "../../css/styles.js";

interface BoundaryBoxesProps {
  primary: DOMRect | null;
  secondary: DOMRect | null;
}

/**
 * Render boundary boxes for selected and secondary elements
 * Uses primitive DOMRect data, no DOM references
 */
export function BoundaryBoxes(props: BoundaryBoxesProps) {
  return (
    <>
      {props.primary && (
        <div
          class={`${PREFIX}boundary-box ${PREFIX}boundary-box-selected`}
          style={{
            left: `${props.primary.left}px`,
            top: `${props.primary.top}px`,
            width: `${props.primary.width}px`,
            height: `${props.primary.height}px`,
          }}
        />
      )}
      {props.secondary && (
        <div
          class={`${PREFIX}boundary-box ${PREFIX}boundary-box-secondary`}
          style={{
            left: `${props.secondary.left}px`,
            top: `${props.secondary.top}px`,
            width: `${props.secondary.width}px`,
            height: `${props.secondary.height}px`,
          }}
        />
      )}
    </>
  );
}
