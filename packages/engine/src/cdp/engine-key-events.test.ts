import { describe, expect, it } from "vitest";
import { buildKeyEventSequence } from "./engine-key-events.js";

describe("buildKeyEventSequence", () => {
  it("uses keyDown, char, keyUp for Enter (chromedp printable pattern)", () => {
    const events = buildKeyEventSequence("Enter");
    expect(events.map((event) => event.type)).toEqual(["keyDown", "char", "keyUp"]);
    expect(events[0]).toMatchObject({
      key: "Enter",
      code: "Enter",
      windowsVirtualKeyCode: 13,
    });
    expect(events[1]).toMatchObject({ type: "char", text: "\r", unmodifiedText: "\r" });
  });

  it("uses keyDown and keyUp only for Escape", () => {
    const events = buildKeyEventSequence("Escape");
    expect(events.map((event) => event.type)).toEqual(["keyDown", "keyUp"]);
    expect(events[0]).toMatchObject({ key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  });

  it("maps Space with code and key as space character", () => {
    const events = buildKeyEventSequence("Space");
    expect(events.map((event) => event.type)).toEqual(["keyDown", "char", "keyUp"]);
    expect(events[0]).toMatchObject({ key: " ", code: " ", windowsVirtualKeyCode: 32 });
  });

  it("passes modifiers on every event", () => {
    const events = buildKeyEventSequence("Tab", 8);
    for (const event of events) {
      expect(event.modifiers).toBe(8);
    }
  });
});
