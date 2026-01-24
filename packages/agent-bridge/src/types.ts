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

export type CaliperActionResult =
    | { success: true; intent: "CALIPER_SELECT"; selector: string; selection: SelectionMetadata; timestamp: number }
    | { success: true; intent: "CALIPER_MEASURE"; selector: string; measurement: MeasurementResult; timestamp: number }
    | {
        success: true;
        intent: "CALIPER_INSPECT";
        selector: string;
        distances: { top: number; right: number; bottom: number; left: number; horizontal: number; vertical: number };
        computedStyles: {
            paddingLeft: number;
            paddingRight: number;
            paddingTop: number;
            paddingBottom: number;
            marginLeft: number;
            marginRight: number;
            marginTop: number;
            marginBottom: number;
        };
        selection: SelectionMetadata;
        timestamp: number;
    }
    | { success: true; intent: "CALIPER_FREEZE"; timestamp: number }
    | { success: true; intent: "CALIPER_CLEAR"; timestamp: number }
    | {
        success: true;
        intent: "CALIPER_WALK_DOM";
        selector: string;
        domContext: {
            element: any;
            parent: any;
            children: any[]
        };
        timestamp: number
    }
    | { success: false; intent: CaliperIntentType; selector?: string; error: string; timestamp: number };

export type CaliperIntentType =
    | "CALIPER_SELECT"
    | "CALIPER_MEASURE"
    | "CALIPER_INSPECT"
    | "CALIPER_FREEZE"
    | "CALIPER_CLEAR"
    | "CALIPER_WALK_DOM";

export interface CaliperSelectPayload {
    selector: string;
}

export interface CaliperMeasurePayload {
    primarySelector: string;
    secondarySelector: string;
}

export interface CaliperInspectPayload {
    selector: string;
}

export interface CaliperWalkDomPayload {
    selector: string;
    depth?: number;
}

export type CaliperIntent =
    | { type: "CALIPER_SELECT"; payload: CaliperSelectPayload }
    | { type: "CALIPER_MEASURE"; payload: CaliperMeasurePayload }
    | { type: "CALIPER_INSPECT"; payload: CaliperInspectPayload }
    | { type: "CALIPER_FREEZE"; payload: {} }
    | { type: "CALIPER_CLEAR"; payload: {} }
    | { type: "CALIPER_WALK_DOM"; payload: CaliperWalkDomPayload };

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

// WebSocket Message Types
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
