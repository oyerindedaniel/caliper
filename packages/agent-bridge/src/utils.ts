import { type SelectionMetadata, type MeasurementResult } from "@oyerinde/caliper/core";
import { type BridgeSelectionMetadata, type BridgeMeasurementResult } from "./types.js";

export function sanitizeSelection(
    metadata: SelectionMetadata | null | undefined
): BridgeSelectionMetadata | null {
    if (!metadata) return null;
    const { element, ...rest } = metadata;
    return rest;
}

export function sanitizeMeasurement(
    result: MeasurementResult | null | undefined
): BridgeMeasurementResult | null {
    if (!result) return null;
    const { secondaryElement, ...rest } = result;
    return rest;
}
