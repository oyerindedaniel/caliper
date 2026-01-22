import type {
    MeasurementSystem,
    SelectionSystem,
    MeasurementResult,
    SelectionMetadata,
} from "@oyerinde/caliper/core";

export interface ViewportState {
    width: number;
    height: number;
    scrollX: number;
    scrollY: number;
}

export interface ElementGeometry {
    top: number;
    left: number;
    width: number;
    height: number;
    absoluteX: number;
    absoluteY: number;
    zIndex?: number;
    agentId: string;
    selector: string;
    tagName: string;
    textContent?: string;
    id?: string;
    classList?: string[];
}

export interface CaliperAgentState {
    viewport: ViewportState;
    pageGeometry: Record<string, ElementGeometry>;
    activeSelection: SelectionMetadata | null;
    lastMeasurement: MeasurementResult | null;
    lastActionResult: CaliperActionResult | null;
    lastUpdated: number;
}

export interface CaliperActionResult {
    success: boolean;
    intent: CaliperIntentType;
    selector?: string;
    measurement?: MeasurementResult;
    selection?: SelectionMetadata;
    distances?: {
        top: number;
        right: number;
        bottom: number;
        left: number;
        horizontal: number;
        vertical: number;
    };
    error?: string;
    timestamp: number;
}

// Agent-native intent types
export type CaliperIntentType =
    | "CALIPER_SELECT" // Select an element
    | "CALIPER_MEASURE" // Measure between TWO selectors
    | "CALIPER_INSPECT" // Get full geometry of an element
    | "CALIPER_FREEZE" // Freeze current state
    | "CALIPER_CLEAR"; // Clear all

// Agent-native payloads
export interface CaliperSelectPayload {
    selector: string;
}

export interface CaliperMeasurePayload {
    /** Primary element (the "selected" element) */
    primarySelector: string;
    /** Secondary element (the "target" to measure against) */
    secondarySelector: string;
}

export interface CaliperInspectPayload {
    selector: string;
}

export type CaliperIntentPayload =
    | CaliperSelectPayload
    | CaliperMeasurePayload
    | CaliperInspectPayload
    | {};

export interface CaliperIntent {
    type: CaliperIntentType;
    payload: CaliperIntentPayload;
}

export interface AgentBridgeConfig {
    enabled?: boolean;
    securityAttribute?: string;
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


// WebSocket Message Types for the Bridge Relay
export interface RegisterTabMessage {
    type: "REGISTER_TAB";
    payload: {
        tabId: string;
        url: string;
        title: string;
        isFocused: boolean;
    };
}

export interface TabUpdateMessage {
    type: "TAB_UPDATE";
    payload: {
        isFocused: boolean;
    };
}

export interface ToolResponseMessage {
    type: "TOOL_RESPONSE";
    id: string;
    result?: CaliperActionResult | CaliperAgentState;
    error?: string;
}

export interface ToolCallMessage {
    id: string;
    method: string;
    params: Record<string, unknown>;
}

export type BridgeMessage =
    | RegisterTabMessage
    | TabUpdateMessage
    | ToolResponseMessage
    | ToolCallMessage;

declare global {
    interface Window {
        __CALIPER_STATE__?: CaliperAgentState;
        dispatchCaliperIntent?: (intent: CaliperIntent) => Promise<CaliperActionResult>;
    }
}
