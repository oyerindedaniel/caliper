import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { CdpSendClient } from "./cdp-page-session.js";
import type { RuntimeEvaluateResponse } from "./cdp-protocol.js";
import { INSTALL_ENGINE_STATE_REPORTER_EXPRESSION } from "./engine-state-reporter.js";

export class InjectSession {
  private registered = false;

  constructor(private readonly client: CdpSendClient) {}

  async registerCaliperBootstrap(): Promise<void> {
    if (this.registered) {
      return;
    }

    const injectSource = readCaliperInjectScript();
    const bootstrapExpression = buildBootstrapExpression(injectSource);

    await this.client.send("Page.addScriptToEvaluateOnNewDocument", {
      source: bootstrapExpression,
    });

    this.registered = true;
  }

  async injectIntoCurrentDocument(): Promise<void> {
    const injectSource = readCaliperInjectScript();
    await this.client.send<RuntimeEvaluateResponse>("Runtime.evaluate", {
      expression: buildBootstrapExpression(injectSource),
    });
  }
}

const CALIPER_ENGINE_INJECT_BUNDLE = "index.global.js";

function readCaliperInjectScript(): string {
  const require = createRequire(import.meta.url);
  const caliperPackageEntry = require.resolve("@oyerinde/caliper");
  const injectPath = join(dirname(caliperPackageEntry), CALIPER_ENGINE_INJECT_BUNDLE);
  return readFileSync(injectPath, "utf8");
}

function buildBootstrapExpression(scriptSource: string): string {
  const bridgeConfig = JSON.stringify({
    bridge: { enabled: true, relay: false, engineStateBinding: true },
  });

  return `(function () {
    window.__CALIPER_ENGINE_MANAGED__ = true;
    if (window.__CALIPER_ENGINE_INJECTED__) {
      return;
    }
    window.__CALIPER_ENGINE_INJECTED__ = true;
    ${INSTALL_ENGINE_STATE_REPORTER_EXPRESSION}
    const script = document.createElement("script");
    script.setAttribute("data-config", ${JSON.stringify(bridgeConfig)});
    script.textContent = ${JSON.stringify(scriptSource)};
    document.documentElement.appendChild(script);
  })();`;
}
