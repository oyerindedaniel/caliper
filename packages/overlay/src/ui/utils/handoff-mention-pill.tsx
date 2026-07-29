import { formatHandoffAgentIdPill, type HandoffAgentIdPillVariant } from "@caliper/core";
import { PREFIX } from "../../css/styles.js";

interface HandoffMentionPillProps {
  agentId: string;
  color: string;
  highlighted?: boolean;
  variant?: HandoffAgentIdPillVariant;
  onPress?: (agentId: string) => void;
}

export function HandoffMentionPill(props: HandoffMentionPillProps) {
  return (
    <span
      class={`${PREFIX}handoff-mention-pill ${props.highlighted ? `${PREFIX}handoff-mention-pill-highlighted` : ""}`}
      style={{ "--caliper-handoff-pill-color": props.color }}
      onMouseDown={(event) => {
        if (!props.onPress) {
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        props.onPress(props.agentId);
      }}
    >
      {formatHandoffAgentIdPill(props.agentId, props.variant ?? "compact")}
    </span>
  );
}
