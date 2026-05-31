import type {
  CaliperActionResult,
  CaliperIntent,
  EngineRpcRequest,
} from "@oyerinde/caliper-schema";
import {
  launchChrome,
  stopChrome,
  waitForChromeDebugPort,
  type ChromeLaunchResult,
} from "./cdp/chrome-launcher.js";
import { EmulationSession } from "./cdp/emulation-session.js";
import { EngineMeasurementSession } from "./cdp/engine-measurement-session.js";
import { HarnessSession } from "./cdp/harness-session.js";
import { PageSession } from "./cdp/page-session.js";
import { findFreePort } from "./cdp/find-free-port.js";

export type EngineBrowserSessionOptions = {
  targetUrl: string;
  headless?: boolean;
  chromeExecutablePath?: string;
};

export class EngineBrowserSession {
  readonly targetUrl: string;

  private constructor(
    targetUrl: string,
    private readonly chromeLaunch: ChromeLaunchResult,
    private readonly pageSession: PageSession,
    private readonly measurementSession: EngineMeasurementSession
  ) {
    this.targetUrl = targetUrl;
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
      const measurementSession = new EngineMeasurementSession(
        pageSession.client,
        harnessSession,
        emulationSession
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

  async dispatch(request: EngineRpcRequest): Promise<CaliperActionResult> {
    return this.measurementSession.dispatchIntent(request as CaliperIntent);
  }

  async stop(): Promise<void> {
    await this.pageSession.close();
    await stopChrome(this.chromeLaunch);
  }
}
