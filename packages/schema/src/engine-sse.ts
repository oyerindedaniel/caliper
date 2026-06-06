export const CALIPER_ENGINE_STATE_SSE_PATH = "/events/state";

export function buildEngineStateSseUrl(host: string, port: number): string {
  return `http://${host}:${port}${CALIPER_ENGINE_STATE_SSE_PATH}`;
}
