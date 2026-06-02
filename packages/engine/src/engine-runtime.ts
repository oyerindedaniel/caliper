import type { CaliperRpcRequest } from "@oyerinde/caliper-schema";
import { EngineBrowserSession } from "./engine-browser-session.js";
import { type CaliperEngineServerOptions, createStartedEngineServer } from "./engine-server.js";

export type EngineRuntime = {
  server: Awaited<ReturnType<typeof createStartedEngineServer>>;
  browserSession: EngineBrowserSession | null;
  stop: () => Promise<void>;
};

export async function createEngineRuntime(
  options: CaliperEngineServerOptions = {}
): Promise<EngineRuntime> {
  const server = await createStartedEngineServer(options);
  let browserSession: EngineBrowserSession | null = null;

  try {
    if (options.targetUrl) {
      browserSession = await EngineBrowserSession.launch({
        targetUrl: options.targetUrl,
        engineHost: server.host,
        enginePort: server.port,
        sessionId: server.sessionId,
      });
      server.setActiveUrl(browserSession.url);
      server.setChromeConnected(true);
      server.setCaptureHandler((fileName) => browserSession!.resolveCapturePath(fileName));
      server.setRpcHandler((request) => dispatchEngineRpc(browserSession!, request));
    }

    return {
      server,
      browserSession,
      stop: async () => {
        await browserSession?.stop();
        await server.stop();
      },
    };
  } catch (error) {
    await server.stop();
    throw error;
  }
}

async function dispatchEngineRpc(browserSession: EngineBrowserSession, request: CaliperRpcRequest) {
  return browserSession.dispatch(request);
}
