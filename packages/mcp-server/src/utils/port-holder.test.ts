import { afterEach, describe, expect, it } from "vitest";
import {
  isBridgePreemptDisabled,
  isCaliperMcpProcess,
  parseWindowsNetstatListening,
} from "./port-holder.js";

const WINDOWS_LISTENER_CMD =
  '"node"   "C:\\Users\\doyer\\AppData\\Local\\npm-cache\\_npx\\208ee065f668cbe3\\node_modules\\.bin\\\\..\\@oyerinde\\caliper\\dist\\mcp.js" --port 9876';
const WINDOWS_NPX_PARENT_CMD =
  '"C:\\nvm4w\\nodejs\\\\node.exe"  "C:\\nvm4w\\nodejs\\node_modules\\npm\\bin\\npx-cli.js" "-y" "@oyerinde/caliper" "--port" "9876"';

describe("isCaliperMcpProcess", () => {
  it("matches the actual Windows listener command line (npx → @oyerinde/caliper/dist/mcp.js)", () => {
    expect(isCaliperMcpProcess(WINDOWS_LISTENER_CMD)).toBe(true);
  });

  it("does not require the literal substring mcp in npx wrapper-only command lines", () => {
    expect(isCaliperMcpProcess(WINDOWS_NPX_PARENT_CMD)).toBe(false);
  });

  it("matches monorepo and published package paths", () => {
    expect(isCaliperMcpProcess("node C:/repo/packages/mcp-server/dist/index.js")).toBe(true);
    expect(isCaliperMcpProcess("npx -y @oyerinde/caliper-mcp")).toBe(true);
    expect(isCaliperMcpProcess("node /app/node_modules/@oyerinde/caliper/dist/mcp.js")).toBe(true);
  });

  it("is case-insensitive and normalizes backslashes", () => {
    expect(
      isCaliperMcpProcess(
        "NODE C:\\USERS\\X\\NODE_MODULES\\@OYERINDE\\CALIPER\\DIST\\MCP.JS --PORT 9876"
      )
    ).toBe(true);
  });

  it("rejects engine cli, unrelated MCP servers, and empty input", () => {
    expect(isCaliperMcpProcess("node packages/engine/dist/cli.js start")).toBe(false);
    expect(
      isCaliperMcpProcess(
        '"C:\\nodejs\\node.exe" "C:\\nodejs\\node_modules\\@nativecontextindex\\mcp\\dist\\index.js"'
      )
    ).toBe(false);
    expect(isCaliperMcpProcess("node /usr/lib/other-app/server.js")).toBe(false);
    expect(isCaliperMcpProcess("")).toBe(false);
  });
});

describe("isBridgePreemptDisabled", () => {
  const original = process.env.CALIPER_BRIDGE_NO_PREEMPT;

  afterEach(() => {
    if (original === undefined) {
      delete process.env.CALIPER_BRIDGE_NO_PREEMPT;
    } else {
      process.env.CALIPER_BRIDGE_NO_PREEMPT = original;
    }
  });

  it("is false by default", () => {
    delete process.env.CALIPER_BRIDGE_NO_PREEMPT;
    expect(isBridgePreemptDisabled()).toBe(false);
  });

  it("is true when env is 1 or true", () => {
    process.env.CALIPER_BRIDGE_NO_PREEMPT = "1";
    expect(isBridgePreemptDisabled()).toBe(true);
    process.env.CALIPER_BRIDGE_NO_PREEMPT = "true";
    expect(isBridgePreemptDisabled()).toBe(true);
  });
});

describe("parseWindowsNetstatListening", () => {
  const sample = `
  TCP    0.0.0.0:9876           0.0.0.0:0              LISTENING       4242
  TCP    [::]:9876              [::]:0                 LISTENING       4242
  TCP    127.0.0.1:9876         127.0.0.1:51234        ESTABLISHED     7777
  TCP    0.0.0.0:98760          0.0.0.0:0              LISTENING       9999
`;

  it("extracts pid only for LISTENING rows on the exact port", () => {
    expect(parseWindowsNetstatListening(sample, 9876)).toEqual([4242]);
    expect(parseWindowsNetstatListening(sample, 98760)).toEqual([9999]);
  });

  it("ignores ESTABLISHED connections on the same port number", () => {
    expect(parseWindowsNetstatListening(sample, 9876)).not.toContain(7777);
  });

  it("returns empty when port is not listening", () => {
    expect(parseWindowsNetstatListening(sample, 4000)).toEqual([]);
    expect(parseWindowsNetstatListening("", 9876)).toEqual([]);
  });

  it("does not confuse 9876 with 98760", () => {
    expect(parseWindowsNetstatListening(sample, 9876)).not.toContain(9999);
  });
});
