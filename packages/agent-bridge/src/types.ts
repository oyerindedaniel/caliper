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

export interface BridgeSelectionMetadata extends Omit<SelectionMetadata, "element"> { }

export type BridgeMeasurementResult = Omit<MeasurementResult, "secondaryElement">;

export interface CaliperAgentState {
    viewport: ViewportState;
    pageGeometry: Record<string, ElementGeometry>;
    activeSelection: BridgeSelectionMetadata | null;
    lastMeasurement: BridgeMeasurementResult | null;
    lastActionResult: CaliperActionResult | null;
    lastUpdated: number;
}

export type CaliperActionResult =
    | { success: true; method: "CALIPER_SELECT"; selector: string; selection: BridgeSelectionMetadata; timestamp: number }
    | { success: true; method: "CALIPER_MEASURE"; selector: string; measurement: BridgeMeasurementResult; timestamp: number }
    | {
        success: true;
        method: "CALIPER_INSPECT";
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
        selection: BridgeSelectionMetadata;
        timestamp: number;
    }
    | { success: true; method: "CALIPER_FREEZE"; timestamp: number }
    | { success: true; method: "CALIPER_CLEAR"; timestamp: number }
    | {
        success: true;
        method: "CALIPER_WALK_DOM";
        selector: string;
        domContext: {
            element: any;
            parent: any;
            children: any[]
        };
        timestamp: number
    }
    | { success: false; method: CaliperIntentType; selector?: string; error: string; timestamp: number };

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
    | { method: "CALIPER_SELECT"; params: CaliperSelectPayload }
    | { method: "CALIPER_MEASURE"; params: CaliperMeasurePayload }
    | { method: "CALIPER_INSPECT"; params: CaliperInspectPayload }
    | { method: "CALIPER_FREEZE"; params: {} }
    | { method: "CALIPER_CLEAR"; params: {} }
    | { method: "CALIPER_WALK_DOM"; params: CaliperWalkDomPayload };

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

export type ToolCallMessage =
    | { id: string; method: "CALIPER_GET_STATE"; params: {} }
    | { id: string; method: "CALIPER_SELECT"; params: CaliperSelectPayload }
    | { id: string; method: "CALIPER_MEASURE"; params: CaliperMeasurePayload }
    | { id: string; method: "CALIPER_INSPECT"; params: CaliperInspectPayload }
    | { id: string; method: "CALIPER_FREEZE"; params: {} }
    | { id: string; method: "CALIPER_CLEAR"; params: {} }
    | { id: string; method: "CALIPER_WALK_DOM"; params: CaliperWalkDomPayload };

export type BridgeMessage =
    | RegisterTabMessage
    | TabUpdateMessage
    | ToolResponseMessage
    | ToolCallMessage;

declare global {
    interface Window {
        dispatchCaliperIntent?: (intent: CaliperIntent) => Promise<CaliperActionResult>;
    }
}
