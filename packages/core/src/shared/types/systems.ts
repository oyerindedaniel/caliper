import type { MeasurementSystem } from "../../measurement-model/utils/measurement-system.js";
import type { SelectionSystem } from "../../measurement-model/utils/selection-system.js";

export interface CaliperCoreSystems {
    measurementSystem: MeasurementSystem;
    selectionSystem: SelectionSystem;
}

export interface CaliperPlugin {
    name: string;
    install: (instance: OverlayInstance) => void;
    dispose?: () => void;
}

export interface OverlayInstance {
    mount: (container?: HTMLElement) => void;
    dispose: () => void;
    getSystems: () => CaliperCoreSystems | null;
    waitForSystems: () => Promise<CaliperCoreSystems>;
    use: (plugin: CaliperPlugin) => OverlayInstance;
    mounted: boolean;
}
