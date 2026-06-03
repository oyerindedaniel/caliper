import { mkdirSync } from "node:fs";
import type { CaliperActionResult, CaliperRpcRequest } from "@oyerinde/caliper-schema";
import { buildEngineHttpUrl, resolveCaliperProjectPaths } from "@oyerinde/caliper-schema";
import {
  launchChrome,
  stopChrome,
  waitForChromeDebugPort,
  type ChromeLaunchResult,
} from "./cdp/chrome-launcher.js";
import { EmulationSession } from "./cdp/emulation-session.js";
import {
  EngineMeasurementSession,
  type EngineMeasurementSessionOptions,
} from "./cdp/engine-measurement-session.js";
import { HarnessSession } from "./cdp/harness-session.js";
import { PageSession } from "./cdp/page-session.js";
import { findFreePort } from "./cdp/find-free-port.js";

export type EngineBrowserSessionOptions = {
  targetUrl: string;
  headless?: boolean;
  chromeExecutablePath?: string;
  engineHost?: string;
  enginePort?: number;
  sessionId?: string;
};

export class EngineBrowserSession {
  readonly targetUrl: string;
  readonly measurementSession: EngineMeasurementSession;

  private constructor(
    targetUrl: string,
    private readonly chromeLaunch: ChromeLaunchResult,
    private readonly pageSession: PageSession,
    measurementSession: EngineMeasurementSession
  ) {
    this.targetUrl = targetUrl;
    this.measurementSession = measurementSession;
  }

  get url(): string {
    return this.pageSession.url;
  }

  static async launch(options: EngineBrowserSessionOptions): Promise<EngineBrowserSession> {
    const debugPort = await findFreePort();
    const chromeLaunch = await launchChrome({
      debugPort,
      targetUrl: options.targetUrl,
      executablePath: options.chromeExecutablePath,
      headless: options.headless,
    });

    try {
      await waitForChromeDebugPort(debugPort, chromeLaunch);
      const pageSession = await PageSession.open(debugPort, options.targetUrl);
      const harnessSession = new HarnessSession(pageSession.client);
      const emulationSession = new EmulationSession(pageSession.client);

      const measurementOptions = buildMeasurementSessionOptions(options);
      const measurementSession = new EngineMeasurementSession(
        pageSession.client,
        harnessSession,
        emulationSession,
        measurementOptions
      );

      await measurementSession.initialize();
      await harnessSession.ensureReady();

      return new EngineBrowserSession(
        options.targetUrl,
        chromeLaunch,
        pageSession,
        measurementSession
      );
    } catch (error) {
      await stopChrome(chromeLaunch);
      throw error;
    }
  }

  async dispatch(request: CaliperRpcRequest): Promise<CaliperActionResult> {
    return this.measurementSession.dispatchRpc(request);
  }

  resolveCapturePath(fileName: string): string | null {
    return this.measurementSession.getScreenshotSession()?.resolveCapturePath(fileName) ?? null;
  }

  async stop(): Promise<void> {
    await this.pageSession.close();
    await stopChrome(this.chromeLaunch);
  }
}

function buildMeasurementSessionOptions(
  options: EngineBrowserSessionOptions
): EngineMeasurementSessionOptions {
  if (!options.sessionId || options.engineHost === undefined || options.enginePort === undefined) {
    return {};
  }

  const projectPaths = resolveCaliperProjectPaths();
  mkdirSync(projectPaths.capturesDir, { recursive: true });
  mkdirSync(projectPaths.runtimeDir, { recursive: true });

  const captureBaseUrl = buildEngineHttpUrl(options.engineHost, options.enginePort, "");

  return {
    screenshot: {
      capturesDirectory: projectPaths.capturesDir,
      captureBaseUrl,
    },
    projectRoot: projectPaths.projectRoot,
  };
}
