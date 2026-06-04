import {
  CALIPER_MEASUREMENT_ROUTING,
  CALIPER_RUNTIME_MODES,
  type CaliperActionResultFor,
  type CaliperBaseMethod,
  type CaliperEngineMethod,
  type CaliperEngineParams,
  type CaliperMeasurementRouting,
  type CaliperParams,
  type CaliperRuntimeConnection,
} from "@oyerinde/caliper-schema";
import { tabManager } from "./tab-manager.js";
import { bridgeService } from "./bridge-service.js";
import { EngineService } from "./engine-service.js";
import { createLogger } from "../utils/logger.js";

const logger = createLogger("measurement-service");

export type MeasurementServiceOptions = {
  bridgePort: number;
  engineUrl?: string | null;
  engineTargetUrl?: string | null;
  runtimeRouting?: CaliperMeasurementRouting;
  allowScriptEval?: boolean;
};

export class MeasurementService {
  private readonly bridgePort: number;
  private readonly runtimeRouting: CaliperMeasurementRouting;
  private engineService: EngineService | null = null;

  constructor(options: MeasurementServiceOptions) {
    this.bridgePort = options.bridgePort;
    this.runtimeRouting = options.runtimeRouting ?? CALIPER_MEASUREMENT_ROUTING.AUTO;

    if (options.engineUrl) {
      this.engineService = new EngineService({
        engineUrl: options.engineUrl,
        targetUrl: options.engineTargetUrl ?? null,
        allowScriptEval: options.allowScriptEval ?? false,
      });
    }

    if (this.runtimeRouting === CALIPER_MEASUREMENT_ROUTING.ENGINE && !this.engineService) {
      throw new Error(
        'Measurement routing is set to "engine" but no engine URL was configured. Pass --engine or --engine-url.'
      );
    }
  }

  getRuntimeRouting(): CaliperMeasurementRouting {
    return this.runtimeRouting;
  }

  async start(): Promise<void> {
    await bridgeService.start(this.bridgePort);

    logger.info(`Measurement routing: ${this.runtimeRouting}`);

    if (this.engineService && this.runtimeRouting !== CALIPER_MEASUREMENT_ROUTING.ATTACHED) {
      const health = await this.engineService.ensureReady();
      logger.info(
        `Engine ready (${health.sessionId}) chromeConnected=${health.chromeConnected} activeUrl=${health.activeUrl ?? "none"}`
      );
    }
  }

  async stop(): Promise<void> {
    await bridgeService.stop();
    await this.engineService?.stop();
  }

  async call<M extends CaliperBaseMethod>(
    method: M,
    params: CaliperParams<M>
  ): Promise<CaliperActionResultFor<M>> {
    switch (this.runtimeRouting) {
      case CALIPER_MEASUREMENT_ROUTING.ATTACHED:
        return bridgeService.call(method, params);

      case CALIPER_MEASUREMENT_ROUTING.ENGINE:
        if (!this.engineService) {
          throw new Error(
            'Measurement routing is set to "engine" but no engine URL was configured. Pass --engine or --engine-url.'
          );
        }
        logger.info(`Routing ${method} to caliper-engine`);
        return this.engineService.call(method, params);

      case CALIPER_MEASUREMENT_ROUTING.AUTO:
      default:
        if (tabManager.getActiveTab()) {
          return bridgeService.call(method, params);
        }

        if (this.engineService) {
          logger.info(`Routing ${method} to caliper-engine`);
          return this.engineService.call(method, params);
        }

        throw new Error(
          "No Caliper runtime is available. Connect a browser tab with CaliperBridge or start caliper-engine."
        );
    }
  }

  async callEngine<M extends CaliperEngineMethod>(
    method: M,
    params: CaliperEngineParams<M>
  ): Promise<CaliperActionResultFor<M>> {
    if (!this.engineService) {
      throw new Error(
        "Engine control methods require caliper-engine. Start MCP with --runtime engine --engine."
      );
    }

    logger.info(`Routing ${method} to caliper-engine`);
    return this.engineService.call(method, params);
  }

  getEngineHealthUrl(): string | null {
    return this.engineService?.url ?? null;
  }

  getRuntimeConnection(): CaliperRuntimeConnection {
    const activeTab = tabManager.getActiveTab();
    const activeRoute = this.resolveActiveRoute();

    return {
      runtime:
        activeRoute === CALIPER_RUNTIME_MODES.ENGINE
          ? CALIPER_RUNTIME_MODES.ENGINE
          : CALIPER_RUNTIME_MODES.ATTACHED,
      measurementRouting: this.runtimeRouting,
      engineHealthUrl: this.engineService?.url ?? null,
      activeTabId: activeTab?.id ?? null,
      activeTabUrl: activeTab?.url ?? null,
    };
  }

  private resolveActiveRoute():
    | typeof CALIPER_RUNTIME_MODES.ATTACHED
    | typeof CALIPER_RUNTIME_MODES.ENGINE {
    switch (this.runtimeRouting) {
      case CALIPER_MEASUREMENT_ROUTING.ATTACHED:
        return CALIPER_RUNTIME_MODES.ATTACHED;
      case CALIPER_MEASUREMENT_ROUTING.ENGINE:
        return CALIPER_RUNTIME_MODES.ENGINE;
      case CALIPER_MEASUREMENT_ROUTING.AUTO:
      default:
        if (tabManager.getActiveTab()) {
          return CALIPER_RUNTIME_MODES.ATTACHED;
        }
        if (this.engineService) {
          return CALIPER_RUNTIME_MODES.ENGINE;
        }
        return CALIPER_RUNTIME_MODES.ATTACHED;
    }
  }
}

export function createMeasurementService(options: MeasurementServiceOptions): MeasurementService {
  return new MeasurementService(options);
}
