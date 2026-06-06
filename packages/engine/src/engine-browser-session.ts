import { mkdirSync } from "node:fs";
import type { CaliperActionResult, CaliperRpcRequest } from "@oyerinde/caliper-schema";
import { buildEngineHttpUrl } from "@oyerinde/caliper-schema";
import { resolveCaliperProjectPaths } from "@oyerinde/caliper-schema/node";
import {
  launchChrome,
  stopChrome,
  waitForChromeDebugPort,
  type ChromeLaunchResult,
} from "./cdp/chrome-launcher.js";
import { CdpClient } from "./cdp/cdp-client.js";
import { PageRegistry } from "./cdp/page-registry.js";
import { findFreePort } from "./cdp/find-free-port.js";
import type { EngineMeasurementSessionOptions } from "./cdp/engine-measurement-session.js";

export type EngineBrowserSessionOptions = {
  targetUrl?: string | null;
  headless?: boolean;
  chromeExecutablePath?: string;
  engineHost?: string;
  enginePort?: number;
  sessionId?: string;
  allowScriptEval?: boolean;
};

export class EngineBrowserSession {
  readonly pageRegistry: PageRegistry;
  private readonly chromeLaunch: ChromeLaunchResult;

  private constructor(chromeLaunch: ChromeLaunchResult, pageRegistry: PageRegistry) {
    this.chromeLaunch = chromeLaunch;
    this.pageRegistry = pageRegistry;
  }

  get url(): string {
    return this.pageRegistry.getActiveUrl() ?? "about:blank";
  }

  static async launch(options: EngineBrowserSessionOptions = {}): Promise<EngineBrowserSession> {
    const launchUrl = options.targetUrl ?? "about:blank";
    const debugPort = await findFreePort();
    const chromeLaunch = await launchChrome({
      debugPort,
      targetUrl: launchUrl,
      executablePath: options.chromeExecutablePath,
      headless: options.headless,
    });

    try {
      await waitForChromeDebugPort(debugPort, chromeLaunch);
      const browser = await CdpClient.connectBrowser(debugPort);
      const pageRegistry = new PageRegistry(browser, {
        debugPort,
        measurementOptions: buildMeasurementSessionOptions(options),
        initialUrl: options.targetUrl ?? null,
      });
      await pageRegistry.start();

      return new EngineBrowserSession(chromeLaunch, pageRegistry);
    } catch (error) {
      await stopChrome(chromeLaunch);
      throw error;
    }
  }

  async dispatch(request: CaliperRpcRequest): Promise<CaliperActionResult> {
    return this.pageRegistry.dispatch(request);
  }

  resolveCapturePath(fileName: string): string | null {
    return this.pageRegistry.resolveCapturePath(fileName);
  }

  async stop(): Promise<void> {
    await this.pageRegistry.stop();
    await stopChrome(this.chromeLaunch);
  }
}

function buildMeasurementSessionOptions(
  options: EngineBrowserSessionOptions
): EngineMeasurementSessionOptions {
  const measurementOptions: EngineMeasurementSessionOptions = {
    allowScriptEval: options.allowScriptEval ?? false,
  };

  if (!options.sessionId || options.engineHost === undefined || options.enginePort === undefined) {
    return measurementOptions;
  }

  const projectPaths = resolveCaliperProjectPaths();
  mkdirSync(projectPaths.capturesDir, { recursive: true });
  mkdirSync(projectPaths.runtimeDir, { recursive: true });

  const captureBaseUrl = buildEngineHttpUrl(options.engineHost, options.enginePort, "");

  measurementOptions.screenshot = {
    capturesDirectory: projectPaths.capturesDir,
    captureBaseUrl,
  };
  measurementOptions.projectRoot = projectPaths.projectRoot;

  return measurementOptions;
}
