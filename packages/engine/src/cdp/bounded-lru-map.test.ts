import { describe, expect, it } from "vitest";
import { BoundedLruMap } from "./bounded-lru-map.js";

describe("BoundedLruMap", () => {
  it("evicts the oldest entry when capacity is exceeded", () => {
    const map = new BoundedLruMap<string, string>(2);
    map.set("a", "1");
    map.set("b", "2");
    map.set("c", "3");

    expect(map.get("a")).toBeUndefined();
    expect(map.get("b")).toBe("2");
    expect(map.get("c")).toBe("3");
    expect(map.size).toBe(2);
  });

  it("refreshes entry order when an existing key is updated", () => {
    const map = new BoundedLruMap<string, string>(2);
    map.set("a", "1");
    map.set("b", "2");
    map.set("a", "updated");
    map.set("c", "3");

    expect(map.get("b")).toBeUndefined();
    expect(map.get("a")).toBe("updated");
    expect(map.get("c")).toBe("3");
  });
});
