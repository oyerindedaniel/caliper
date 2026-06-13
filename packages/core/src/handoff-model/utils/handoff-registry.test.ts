import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createHandoffRegistry } from "./handoff-registry.js";
import { handoffResolvedNoteToWire } from "./handoff-note.js";
import { persistHandoff } from "./handoff-session.js";
import { HANDOFF_SESSION_KEY } from "@/shared/constants/index.js";

describe("handoffResolvedNoteToWire", () => {
  it("prefixes committed agent ids with @ for editor wire", () => {
    const note = "fix caliper-abc123 layout";
    expect(handoffResolvedNoteToWire(note, ["caliper-abc123"])).toBe("fix @caliper-abc123 layout");
  });
});

describe("createHandoffRegistry session lifecycle", () => {
  let target: HTMLDivElement;

  beforeEach(() => {
    target = document.createElement("div");
    target.textContent = "target";
    document.body.append(target);
    sessionStorage.removeItem(HANDOFF_SESSION_KEY);
  });

  afterEach(() => {
    target.remove();
    sessionStorage.removeItem(HANDOFF_SESSION_KEY);
  });

  it("commit clears live draft but keeps last committed snapshot", () => {
    const registry = createHandoffRegistry();
    registry.toggle(target);
    registry.setPendingNote("note @caliper-abc123 ");
    registry.setInputOpen(true);

    const committed = registry.commitSession();

    expect(committed?.note).toBe("note caliper-abc123 ");
    expect(registry.getItems()).toHaveLength(0);
    expect(registry.getPendingNote()).toBe("");
    expect(registry.isInputOpen()).toBe(false);
    expect(registry.getLastCommitted()?.wireNote).toBe("note @caliper-abc123 ");
  });

  it("rehydrateFromCommitted restores live items and wire note", () => {
    const registry = createHandoffRegistry();
    registry.toggle(target);
    registry.setPendingNote("hello @caliper-abc123 ");
    const committed = registry.commitSession();
    expect(committed).not.toBeNull();

    const restored = registry.rehydrateFromCommitted(committed!, "hello @caliper-abc123 ", {
      openInput: true,
      resolve: () => target,
    });

    expect(restored).toBe(1);
    expect(registry.getItems()).toHaveLength(1);
    expect(registry.getPendingNote()).toBe("hello @caliper-abc123 ");
    expect(registry.isInputOpen()).toBe(true);
  });

  it("clear wipes last committed snapshot", () => {
    const registry = createHandoffRegistry();
    registry.toggle(target);
    registry.setPendingNote("done");
    registry.commitSession();
    expect(registry.getLastCommitted()).not.toBeNull();

    registry.clear();
    expect(registry.getLastCommitted()).toBeNull();
  });

  it("seeds last committed from sessionStorage on create", () => {
    const first = createHandoffRegistry();
    first.toggle(target);
    const agentId = first.getItems()[0]!.agentId;
    first.setPendingNote(`seed @${agentId} `);
    const committed = first.commitSession();
    persistHandoff(committed);

    const registry = createHandoffRegistry(() => target);
    expect(registry.getLastCommitted()?.wireNote).toBe(`seed @${agentId} `);
  });
});
