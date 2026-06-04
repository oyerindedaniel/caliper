import type { CaliperActionResult } from "./bridge.js";
import { CALIPER_METHODS, isCaliperActionResultMethod } from "./bridge.js";
import { CaliperNodeSchema } from "./audit.js";
import { BitBridge } from "./serialization.js";

export type WalkAndMeasureSuccess = Extract<
  CaliperActionResult,
  { success: true; method: typeof CALIPER_METHODS.WALK_AND_MEASURE }
>;

export type RehydrateWalkResult =
  | { ok: true; result: WalkAndMeasureSuccess }
  | { ok: false; error: string };

export function isWalkAndMeasureSuccess(
  result: CaliperActionResult
): result is WalkAndMeasureSuccess {
  return (
    result.success === true &&
    isCaliperActionResultMethod(result, CALIPER_METHODS.WALK_AND_MEASURE)
  );
}

function bytesToBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(bytes).toString("base64");
  }

  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const chunk = bytes.subarray(offset, offset + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

function base64ToBytes(encoded: string): Uint8Array {
  if (typeof Buffer !== "undefined") {
    return new Uint8Array(Buffer.from(encoded, "base64"));
  }

  const binary = atob(encoded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function readWalkBinaryPayload(
  walk: WalkAndMeasureSuccess,
  binaryFromEnvelope?: Uint8Array
): Uint8Array | null {
  if (binaryFromEnvelope) {
    return binaryFromEnvelope;
  }

  if (typeof walk.binaryPayloadBase64 === "string" && walk.binaryPayloadBase64.length > 0) {
    return base64ToBytes(walk.binaryPayloadBase64);
  }

  const inMemoryPayload = walk.binaryPayload;
  if (inMemoryPayload instanceof Uint8Array) {
    return inMemoryPayload;
  }

  return null;
}

export function prepareWalkResultForJsonWire(result: CaliperActionResult): CaliperActionResult {
  if (!isWalkAndMeasureSuccess(result)) {
    return result;
  }

  const { binaryPayload } = result;
  if (!(binaryPayload instanceof Uint8Array)) {
    return result;
  }

  const { binaryPayload: _removed, binaryPayloadBase64: _existing, ...metadata } = result;
  return {
    ...metadata,
    binaryPayloadBase64: bytesToBase64(binaryPayload),
  };
}

export function rehydrateWalkAndMeasureResult(
  result: WalkAndMeasureSuccess,
  binaryFromEnvelope?: Uint8Array
): RehydrateWalkResult {
  const binaryPayload = readWalkBinaryPayload(result, binaryFromEnvelope);
  if (!binaryPayload) {
    return { ok: true, result };
  }

  try {
    const raw = BitBridge.deserialize(binaryPayload);
    const parsed = CaliperNodeSchema.safeParse(raw);
    if (!parsed.success) {
      return {
        ok: false,
        error: "Walk and measure tree payload failed schema validation",
      };
    }

    const {
      binaryPayload: _binaryPayload,
      binaryPayloadBase64: _binaryPayloadBase64,
      ...metadata
    } = result;

    return {
      ok: true,
      result: {
        ...metadata,
        walkResult: {
          ...metadata.walkResult,
          root: parsed.data,
        },
      },
    };
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof Error
          ? error.message
          : "Walk and measure tree payload could not be reconstructed",
    };
  }
}
