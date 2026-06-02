import { buildEngineHttpUrl, DEFAULT_ENGINE_HOST } from "@oyerinde/caliper-schema";
import { pollUntil } from "@engine/utils/poll-until.js";
import { CdpClient } from "./cdp-client.js";
import type { CdpPageTarget } from "./cdp-protocol.js";

export class PageSession {
  readonly client: CdpClient;
  readonly debugPort: number;
  private activeUrl: string;

  private constructor(client: CdpClient, debugPort: number, activeUrl: string) {
    this.client = client;
    this.debugPort = debugPort;
    this.activeUrl = activeUrl;
  }

  get url(): string {
    return this.activeUrl;
  }

  static async open(debugPort: number, targetUrl: string): Promise<PageSession> {
    const pageTarget = await acquirePageTarget(debugPort, targetUrl);
    const client = await CdpClient.connect(pageTarget.webSocketDebuggerUrl);

    await client.send("Page.enable");
    await client.send("Runtime.enable");

    const session = new PageSession(client, debugPort, pageTarget.url);
    await session.navigateIfNeeded(targetUrl);
    return session;
  }

  async navigateIfNeeded(targetUrl: string): Promise<void> {
    if (!shouldNavigate(this.activeUrl, targetUrl)) {
      return;
    }

    await this.client.send("Page.navigate", { url: targetUrl });
    await this.client.waitForEvent("Page.loadEventFired");
    this.activeUrl = targetUrl;
  }

  async close(): Promise<void> {
    await this.client.close();
  }
}

async function acquirePageTarget(debugPort: number, targetUrl: string): Promise<CdpPageTarget> {
  const existingTarget = await pollUntil(
    async () => {
      const targets = await CdpClient.listPageTargets(debugPort);
      return targets.find((target) => target.type === "page") ?? null;
    },
    {
      intervalMs: 250,
      timeoutMs: 30_000,
      errorMessage: "Chrome did not expose a page target",
    }
  );

  if (existingTarget.url !== "about:blank" || !shouldNavigate(existingTarget.url, targetUrl)) {
    return existingTarget;
  }

  const newTabResponse = await fetch(
    buildEngineHttpUrl(
      DEFAULT_ENGINE_HOST,
      debugPort,
      `/json/new?${encodeURIComponent(targetUrl)}`
    ),
    { method: "PUT" }
  );

  if (!newTabResponse.ok) {
    throw new Error(`Failed to create Chrome page target (${newTabResponse.status})`);
  }

  return (await newTabResponse.json()) as CdpPageTarget;
}

function shouldNavigate(currentUrl: string, targetUrl: string): boolean {
  if (currentUrl === "about:blank") {
    return true;
  }

  try {
    return new URL(currentUrl).href !== new URL(targetUrl).href;
  } catch {
    return true;
  }
}
