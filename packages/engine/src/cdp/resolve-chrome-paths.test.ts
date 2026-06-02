import { describe, expect, it } from "vitest";
import { resolveSystemChromePaths } from "./resolve-chrome-paths.js";

describe("resolveSystemChromePaths", () => {
  it("includes Puppeteer-aligned Windows prefixes when on win32", () => {
    if (process.platform !== "win32") {
      return;
    }

    const paths = resolveSystemChromePaths();
    expect(paths.some((path) => path.includes("Google\\Chrome\\Application\\chrome.exe"))).toBe(
      true
    );
    expect(
      paths.some((path) => path.startsWith("C:\\Program Files\\Google\\Chrome\\Application\\"))
    ).toBe(true);
  });

  it("includes the standard macOS Chrome path when on darwin", () => {
    if (process.platform !== "darwin") {
      return;
    }

    expect(resolveSystemChromePaths()).toContain(
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
    );
  });
});
