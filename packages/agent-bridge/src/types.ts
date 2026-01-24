import type {
    MeasurementSystem,
    SelectionSystem,
} from "@oyerinde/caliper/core";
import type {
    CaliperAgentState,
    CaliperIntent,
    CaliperActionResult,
    ElementGeometry as SchemaElementGeometry,
} from "@oyerinde/caliper-schema";

export interface ElementGeometry extends SchemaElementGeometry {
    agentId: string;
    selector: string;
    tagName: string;
    textContent?: string;
    id?: string;
    classList?: string[];
}

export type {
    CaliperAgentState,
    CaliperIntent,
    CaliperActionResult,
    ViewportState,
    CaliperSelectPayload,
    CaliperMeasurePayload,
    CaliperInspectPayload,
    CaliperWalkDomPayload,
    CaliperIntentType,
    ToolCallMessage,
    BridgeMessageUnion,
} from "@oyerinde/caliper-schema";

export interface AgentBridgeConfig {
    enabled?: boolean;
    wsUrl?: string;
    debounceMs?: number;
    minElementSize?: number;
    onStateChange?: (state: CaliperAgentState) => void;
}

export interface CaliperCoreSystems {
    measurementSystem: MeasurementSystem;
    selectionSystem: SelectionSystem;
    onViewportChange: (listener: () => void) => () => void;
}

declare global {
    interface Window {
        dispatchCaliperIntent?: (intent: CaliperIntent) => Promise<CaliperActionResult>;
    }
}
