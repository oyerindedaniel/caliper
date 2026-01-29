import type {
    CaliperIntent,
    CaliperActionResult,
} from "@oyerinde/caliper-schema";

declare global {
    interface Window {
        dispatchCaliperIntent?: (intent: CaliperIntent) => Promise<CaliperActionResult>;
    }
}
