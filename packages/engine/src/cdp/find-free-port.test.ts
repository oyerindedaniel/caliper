import { describe, expect, it } from "vitest";
import { findFreePort } from "./find-free-port.js";

describe("findFreePort", () => {
  it("returns a usable TCP port", async () => {
    const port = await findFreePort();
    expect(port).toBeGreaterThan(0);
    expect(port).toBeLessThan(65536);
  });
});
