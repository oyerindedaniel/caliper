import type { MeasurementSystem } from "../../measurement-model/utils/measurement-system.js";
import type { SelectionSystem } from "../../measurement-model/utils/selection-system.js";

export interface CaliperCoreSystems {
  measurementSystem: MeasurementSystem;
  selectionSystem: SelectionSystem;
}

/**
 * A plugin allows extending Caliper's functionality by accessing the
 * OverlayInstance and internal systems.
 */
export interface CaliperPlugin {
  /** Unique identifier for the plugin. Used for deduplication. */
  name: string;
  /** Called when the plugin is installed on an overlay instance. */
  install: (instance: OverlayInstance) => void;
  /** Optional cleanup logic called when the overlay is disposed. */
  dispose?: () => void;
}

/**
 * Handle to a running Caliper overlay.
 */
export interface OverlayInstance {
  /**
   * Mounts the overlay into the DOM.
   * By default, it mounts into document.documentElement (safe for Shadow DOM).
   */
  mount: (container?: HTMLElement) => void;

  /**
   * Removes the overlay from the DOM and cleans up all event listeners and systems.
   */
  dispose: () => void;

  /**
   * Synchronously returns the internal systems if they are initialized.
   */
  getSystems: () => CaliperCoreSystems | null;

  /**
   * Asynchronous helper that resolves when the internal systems are ready.
   * Useful for plugins that need to interact with the DOM or state immediately.
   */
  waitForSystems: () => Promise<CaliperCoreSystems>;

  /**
   * Registers a plugin with this instance.
   */
  use: (plugin: CaliperPlugin) => OverlayInstance;

  /** Whether the overlay is currently mounted in the document. */
  mounted: boolean;
}
