import { describe, expect, it } from "vitest";
import { CALIPER_METHODS, parseCaliperActionResult } from "./bridge.js";
import type { CaliperActionResult } from "./bridge.js";
import type { CaliperNode } from "./audit.js";
import { BitBridge } from "./serialization.js";
import type { WalkAndMeasureSuccess } from "./walk-result-transport.js";
import {
  prepareWalkResultForJsonWire,
  rehydrateWalkAndMeasureResult,
} from "./walk-result-transport.js";

function createMinimalWalkNode(): CaliperNode {
  return {
    agentId: "root",
    tag: "div",
    selector: "div",
    classes: [],
    rect: { top: 0, left: 0, width: 10, height: 10, bottom: 10, right: 10, x: 0, y: 0 },
    viewportRect: { top: 0, left: 0 },
    depth: 0,
    childCount: 0,
    children: [],
    styles: {
      display: "block",
      position: "static",
      boxSizing: "border-box",
      fontSize: 16,
      fontWeight: "400",
      fontFamily: "sans-serif",
      color: "black",
      backgroundColor: "white",
      padding: { top: 0, right: 0, bottom: 0, left: 0 },
      margin: { top: 0, right: 0, bottom: 0, left: 0 },
      border: { top: 0, right: 0, bottom: 0, left: 0 },
      borderRadius: "0px",
      opacity: 1,
      overflow: "visible",
      overflowX: "visible",
      overflowY: "visible",
      gap: null,
      lineHeight: "normal",
      letterSpacing: "normal",
      zIndex: null,
    },
    measurements: {
      toParent: { top: 0, left: 0, bottom: 0, right: 0 },
      toPreviousSibling: null,
      toNextSibling: null,
      indexInParent: 0,
      siblingCount: 0,
    },
  };
}

function createWalkSuccessResult(root: CaliperNode): WalkAndMeasureSuccess {
  const binaryPayload = BitBridge.serialize(root);
  return {
    success: true,
    method: CALIPER_METHODS.WALK_AND_MEASURE,
    selector: "#app",
    walkResult: {
      nodeCount: 1,
      maxDepthReached: 0,
      walkDurationMs: 12,
    },
    binaryPayload,
    timestamp: 1,
  };
}

describe("walk-result-transport", () => {
  it("prepareWalkResultForJsonWire encodes binary and removes Uint8Array for JSON round-trip", () => {
    const root = createMinimalWalkNode();
    const walkResult = createWalkSuccessResult(root);
    const prepared = prepareWalkResultForJsonWire(walkResult);
    if (!prepared.success || prepared.method !== CALIPER_METHODS.WALK_AND_MEASURE) {
      throw new Error("expected walk success");
    }

    expect("binaryPayload" in prepared).toBe(false);
    expect(typeof prepared.binaryPayloadBase64).toBe("string");

    const wireResult = parseCaliperActionResult(JSON.parse(JSON.stringify(prepared)));
    expect(wireResult).not.toBeNull();
    if (!wireResult?.success || wireResult.method !== CALIPER_METHODS.WALK_AND_MEASURE) {
      throw new Error("expected walk success after JSON round-trip");
    }

    const rehydrated = rehydrateWalkAndMeasureResult(wireResult);
    expect(rehydrated.ok).toBe(true);
    if (!rehydrated.ok) {
      throw new Error("expected rehydrate success");
    }

    expect(rehydrated.result.walkResult.root?.agentId).toBe(root.agentId);
    expect("binaryPayloadBase64" in rehydrated.result).toBe(false);
    expect("binaryPayload" in rehydrated.result).toBe(false);
  });

  it("rehydrateWalkAndMeasureResult uses WebSocket envelope bytes when provided", () => {
    const root = createMinimalWalkNode();
    const binaryPayload = BitBridge.serialize(root);
    const metadata: WalkAndMeasureSuccess = {
      success: true,
      method: CALIPER_METHODS.WALK_AND_MEASURE,
      selector: "#app",
      walkResult: {
        nodeCount: 1,
        maxDepthReached: 0,
        walkDurationMs: 12,
      },
      timestamp: 1,
    };

    const rehydrated = rehydrateWalkAndMeasureResult(metadata, binaryPayload);
    expect(rehydrated.ok).toBe(true);
    if (!rehydrated.ok) {
      throw new Error("expected success");
    }

    expect(rehydrated.result.walkResult.root?.tag).toBe("div");
  });

  it("returns failure when BitBridge bytes are invalid", () => {
    const broken: WalkAndMeasureSuccess = {
      success: true,
      method: CALIPER_METHODS.WALK_AND_MEASURE,
      selector: "#app",
      walkResult: {
        nodeCount: 0,
        maxDepthReached: 0,
        walkDurationMs: 0,
      },
      binaryPayloadBase64: Buffer.from("not-bitbridge").toString("base64"),
      timestamp: 1,
    };

    const rehydrated = rehydrateWalkAndMeasureResult(broken);
    expect(rehydrated.ok).toBe(false);
    if (rehydrated.ok) {
      throw new Error("expected failure");
    }
    expect(rehydrated.error.length).toBeGreaterThan(0);
  });

  it("rehydrateWalkAndMeasureResult passes through when no binary source exists", () => {
    const metadata: WalkAndMeasureSuccess = {
      success: true,
      method: CALIPER_METHODS.WALK_AND_MEASURE,
      selector: "#app",
      walkResult: {
        nodeCount: 0,
        maxDepthReached: 0,
        walkDurationMs: 0,
      },
      timestamp: 1,
    };

    const rehydrated = rehydrateWalkAndMeasureResult(metadata);
    expect(rehydrated).toEqual({ ok: true, result: metadata });
  });

  it("prepareWalkResultForJsonWire leaves walk result unchanged without in-memory binaryPayload", () => {
    const metadata: WalkAndMeasureSuccess = {
      success: true,
      method: CALIPER_METHODS.WALK_AND_MEASURE,
      selector: "#app",
      walkResult: {
        nodeCount: 0,
        maxDepthReached: 0,
        walkDurationMs: 0,
      },
      binaryPayloadBase64: Buffer.from("already-on-wire").toString("base64"),
      timestamp: 1,
    };

    expect(prepareWalkResultForJsonWire(metadata)).toBe(metadata);
  });

  it("rehydrateWalkAndMeasureResult prefers WebSocket envelope bytes over metadata base64", () => {
    const root = createMinimalWalkNode();
    const envelopeBytes = BitBridge.serialize(root);
    const metadata: WalkAndMeasureSuccess = {
      success: true,
      method: CALIPER_METHODS.WALK_AND_MEASURE,
      selector: "#app",
      walkResult: {
        nodeCount: 1,
        maxDepthReached: 0,
        walkDurationMs: 12,
      },
      binaryPayloadBase64: Buffer.from("wrong-metadata-bytes").toString("base64"),
      timestamp: 1,
    };

    const rehydrated = rehydrateWalkAndMeasureResult(metadata, envelopeBytes);
    expect(rehydrated.ok).toBe(true);
    if (!rehydrated.ok) {
      throw new Error("expected success");
    }
    expect(rehydrated.result.walkResult.root?.agentId).toBe(root.agentId);
  });

  it("prepareWalkResultForJsonWire leaves non-walk results unchanged", () => {
    const freeze: CaliperActionResult = {
      success: true,
      method: CALIPER_METHODS.FREEZE,
      timestamp: 1,
    };

    expect(prepareWalkResultForJsonWire(freeze)).toBe(freeze);
  });
});
