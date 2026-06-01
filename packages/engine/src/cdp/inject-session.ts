import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { CdpClient } from "./cdp-client.js";
import type { RuntimeEvaluateResponse } from "./cdp-protocol.js";

export class InjectSession {
  private registered = false;

  constructor(private readonly client: CdpClient) {}

  async registerCaliperBootstrap(): Promise<void> {
    if (this.registered) {
      return;
    }

    await this.client.send("Page.enable");
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

function readCaliperInjectScript(): string {
  const require = createRequire(import.meta.url);
  const caliperPackageJsonPath = require.resolve("@oyerinde/caliper/package.json");
  const injectPath = join(dirname(caliperPackageJsonPath), "dist", "index.js");
  return readFileSync(injectPath, "utf8");
}

function buildBootstrapExpression(scriptSource: string): string {
  const bridgeConfig = JSON.stringify({ bridge: { enabled: true, relay: false } });

  return `(function () {
    if (window.__CALIPER_ENGINE_INJECTED__) {
      return;
    }
    window.__CALIPER_ENGINE_INJECTED__ = true;
    const script = document.createElement("script");
    script.setAttribute("data-config", ${JSON.stringify(bridgeConfig)});
    script.textContent = ${JSON.stringify(scriptSource)};
    document.documentElement.appendChild(script);
  })();`;
}
