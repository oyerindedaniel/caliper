import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { bridgeService } from "./bridge-service.js";
import { tabManager } from "./tab-manager.js";
import { createLogger } from "../utils/logger.js";
import { parseColor, calculateDeltaE, calculateContrastRatio } from "../utils/color-utils.js";
import { DEFAULT_BRIDGE_PORT } from "../shared/constants.js";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

let packageJsonPath = join(__dirname, "../../package.json");
try {
  if (__dirname.endsWith("dist")) {
    packageJsonPath = join(__dirname, "../package.json");
  }
} catch (_) {}

const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"));

const logger = createLogger("mcp-server");

export class CaliperMcpServer {
  private server: McpServer;
  private port: number;

  constructor(port: number = DEFAULT_BRIDGE_PORT) {
    this.port = port;
    this.server = new McpServer({
      name: "caliper-mcp-server",
      version: packageJson.version,
    });

    this.registerTools();
    this.registerResources();
    this.registerPrompts();
  }

  private registerTools() {
    this.server.registerTool(
      "caliper_list_tabs",
      {
        description: "List all browser tabs currently connected to the Caliper Agent Bridge.",
        inputSchema: z.object({}),
      },
      async () => {
        const tabs = tabManager.getAllTabs().map((tab) => ({
          id: tab.id,
          title: tab.title,
          url: tab.url,
          isActive: tab.id === tabManager.getActiveTab()?.id,
        }));
        return { content: [{ type: "text", text: JSON.stringify(tabs, null, 2) }] };
      }
    );

    this.server.registerTool(
      "caliper_switch_tab",
      {
        description: "Switch the active targeting to a specific browser tab.",
        inputSchema: z.object({
          tabId: z.string().describe("The ID of the tab to target"),
        }),
      },
      async ({ tabId }) => {
        if (tabManager.switchTab(tabId)) {
          return {
            content: [
              { type: "text", text: `Switched to tab: ${tabManager.getActiveTab()?.title}` },
            ],
          };
        }
        return {
          content: [{ type: "text", text: `Error: Tab ${tabId} not found` }],
          isError: true,
        };
      }
    );

    this.server.registerTool(
      "caliper_inspect",
      {
        description: "Get full geometry and computed visibility for an element.",
        inputSchema: z.object({
          selector: z
            .string()
            .describe("Caliper ID, JSON Fingerprint, or CSS selector of the element"),
        }),
      },
      async ({ selector }) => {
        try {
          const result = await bridgeService.call("CALIPER_INSPECT", { selector });
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        } catch (error) {
          return {
            content: [
              {
                type: "text",
                text: `Error inspecting element: ${error instanceof Error ? error.message : String(error)}`,
              },
            ],
            isError: true,
          };
        }
      }
    );

    this.server.registerTool(
      "caliper_measure",
      {
        description: "Perform a high-precision measurement between two elements.",
        inputSchema: z.object({
          primarySelector: z
            .string()
            .describe("Caliper ID, JSON Fingerprint, or CSS selector for the primary element"),
          secondarySelector: z
            .string()
            .describe("Caliper ID, JSON Fingerprint, or CSS selector for the target element"),
        }),
      },
      async ({ primarySelector, secondarySelector }) => {
        try {
          const result = await bridgeService.call("CALIPER_MEASURE", {
            primarySelector,
            secondarySelector,
          });
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        } catch (error) {
          return {
            content: [
              {
                type: "text",
                text: `Error performing measurement: ${error instanceof Error ? error.message : String(error)}`,
              },
            ],
            isError: true,
          };
        }
      }
    );

    this.server.registerTool(
      "caliper_clear",
      {
        description: "Clear all measurements and selections in the browser UI.",
        inputSchema: z.object({}),
      },
      async () => {
        try {
          const result = await bridgeService.call("CALIPER_CLEAR", {});
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        } catch (error) {
          return {
            content: [
              {
                type: "text",
                text: `Error clearing UI: ${error instanceof Error ? error.message : String(error)}`,
              },
            ],
            isError: true,
          };
        }
      }
    );

    this.server.registerTool(
      "caliper_walk_dom",
      {
        description:
          "Get the semantic context of an element by traversing its parents and children. Useful for understanding component hierarchy.",
        inputSchema: z.object({
          selector: z
            .string()
            .describe("Caliper ID, JSON Fingerprint, or CSS selector of the element"),
        }),
      },
      async ({ selector }) => {
        try {
          const result = await bridgeService.call("CALIPER_WALK_DOM", { selector });
          return { content: [{ type: "text", text: JSON.stringify(result) }] };
        } catch (error) {
          return {
            content: [
              {
                type: "text",
                text: `DOM Walk failed: ${error instanceof Error ? error.message : String(error)}`,
              },
            ],
            isError: true,
          };
        }
      }
    );

    this.server.registerTool(
      "caliper_walk_and_measure",
      {
        description: `Walk the DOM tree starting from a selector and capture precise measurements.

This is the HARNESS tool for comprehensive audits. It:
- Walks the DOM tree using BFS (breadth-first) 
- Captures computed styles for each node (padding, margin, gap, typography, colors)
- Measures gaps between siblings and distance to parent edges
- Returns a full tree structure ready for reconciliation with Figma

Use this BEFORE making any code changes to gather complete context.

The output includes:
- root: The full measured tree (recursive CaliperNode structure)
- nodeCount: Total nodes captured
- maxDepthReached: Deepest level reached
- walkDurationMs: Time taken to complete the walk`,
        inputSchema: z.object({
          selector: z
            .string()
            .describe("Caliper ID, JSON Fingerprint, or CSS selector of the root element to walk"),
          maxDepth: z.number().optional().describe("Maximum depth to walk (default: 5)"),
        }),
      },
      async ({ selector, maxDepth }) => {
        try {
          const result = await bridgeService.call("CALIPER_WALK_AND_MEASURE", {
            selector,
            maxDepth: maxDepth ?? 5,
          });
          return { content: [{ type: "text", text: JSON.stringify(result) }] };
        } catch (error) {
          return {
            content: [
              {
                type: "text",
                text: `Walk and Measure failed: ${error instanceof Error ? error.message : String(error)}`,
              },
            ],
            isError: true,
          };
        }
      }
    );

    this.server.registerTool(
      "caliper_get_context",
      {
        description:
          "Get comprehensive window, viewport, and accessibility metrics from the current browser tab.",
        inputSchema: z.object({}),
      },
      async () => {
        try {
          const result = await bridgeService.call("CALIPER_GET_CONTEXT", {});
          return { content: [{ type: "text", text: JSON.stringify(result) }] };
        } catch (error) {
          return {
            content: [
              {
                type: "text",
                text: `Get Context failed: ${error instanceof Error ? error.message : String(error)}`,
              },
            ],
            isError: true,
          };
        }
      }
    );

    this.server.registerTool(
      "caliper_check_contrast",
      {
        description: `Check WCAG 2.1 contrast ratio between two colors.

Returns the contrast ratio (1-21) and pass/fail status for:
- AA Normal Text (4.5:1)
- AA Large Text (3:1)
- AAA Normal Text (7:1)
- AAA Large Text (4.5:1)`,
        inputSchema: z.object({
          foreground: z
            .string()
            .describe("Foreground color (any CSS format: hex, rgb, hsl, oklch, etc.)"),
          background: z
            .string()
            .describe("Background color (any CSS format: hex, rgb, hsl, oklch, etc.)"),
        }),
      },
      async ({ foreground, background }) => {
        try {
          const fg = parseColor(foreground);
          const bg = parseColor(background);
          const ratio = calculateContrastRatio(fg, bg);

          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    foreground,
                    background,
                    ratio: Number(ratio.toFixed(2)),
                    passAA: ratio >= 4.5,
                    passAALarge: ratio >= 3,
                    passAAA: ratio >= 7,
                    passAAALarge: ratio >= 4.5,
                  },
                  null,
                  2
                ),
              },
            ],
          };
        } catch (error) {
          return {
            content: [
              {
                type: "text",
                text: `Contrast check failed: ${error instanceof Error ? error.message : String(error)}`,
              },
            ],
            isError: true,
          };
        }
      }
    );

    this.server.registerTool(
      "caliper_delta_e",
      {
        description: `Calculate perceptual color difference (Delta E) between two colors using Oklab.

Returns the Delta E value and a human-readable interpretation:
- < 0.02: Imperceptible
- 0.02-0.05: Just noticeable
- 0.05-0.1: Noticeable
- 0.1-0.3: Distinct
- > 0.3: Very different`,
        inputSchema: z.object({
          color1: z.string().describe("First color (any CSS format: hex, rgb, hsl, oklch, etc.)"),
          color2: z.string().describe("Second color (any CSS format: hex, rgb, hsl, oklch, etc.)"),
        }),
      },
      async ({ color1, color2 }) => {
        try {
          const c1 = parseColor(color1);
          const c2 = parseColor(color2);
          const deltaE = calculateDeltaE(c1, c2);

          let interpretation: string;
          if (deltaE < 0.02) interpretation = "Imperceptible (< 0.02)";
          else if (deltaE < 0.05) interpretation = "Just noticeable (0.02-0.05)";
          else if (deltaE < 0.1) interpretation = "Noticeable (0.05-0.1)";
          else if (deltaE < 0.3) interpretation = "Distinct (0.1-0.3)";
          else interpretation = "Very different (> 0.3)";

          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    color1,
                    color2,
                    deltaE: Number(deltaE.toFixed(4)),
                    interpretation,
                  },
                  null,
                  2
                ),
              },
            ],
          };
        } catch (error) {
          return {
            content: [
              {
                type: "text",
                text: `Delta E calculation failed: ${error instanceof Error ? error.message : String(error)}`,
              },
            ],
            isError: true,
          };
        }
      }
    );
  }

  private registerResources() {
    this.server.registerResource(
      "caliper-tabs",
      "caliper://tabs",
      { description: "List of all browser tabs currently connected to the bridge." },
      async () => {
        const tabs = tabManager.getAllTabs().map((tab) => ({
          id: tab.id,
          title: tab.title,
          url: tab.url,
          isActive: tab.id === tabManager.getActiveTab()?.id,
        }));
        return {
          contents: [
            {
              uri: "caliper://tabs",
              mimeType: "application/json",
              text: JSON.stringify(tabs, null, 2),
            },
          ],
        };
      }
    );
  }

  private registerPrompts() {
    this.server.registerPrompt(
      "caliper-selector-audit",
      {
        description:
          "Perform a comprehensive, structured audit of a specific selector: from source discovery to precision styling analysis.",
        argsSchema: {
          selector: z.string().describe("The Caliper Selector (Agent ID) or CSS selector to audit"),
        },
      },
      async ({ selector }) => ({
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text: `## CALIPER SELECTOR AUDIT: ${selector}

You are about to perform a structured, comprehensive audit of the element '${selector}'. Follow these phases precisely.

### PHASE 1: CONTEXT GATHERING
1. **Deep Inspection**: Call 'caliper_inspect' to get all computed styles, colors, and typography.
2. **Hierarchy Walk**: Call 'caliper_walk_and_measure' with maxDepth: 3 to understand its position in the tree, its children, and the spacing (gaps) to its neighbors.
3. **Stable Discovery**: Identify a STABLE identifier (ID, data-testid, unique text, or stable class) and use internal agent search (grep) to locate the exact source file and line number.

### PHASE 2: ANALYSIS & CONSISTENCY
4. **Spacing Check**: Analyze if padding, margins, and gaps follow a consistent scale (e.g., multiples of 4px/8px).
5. **System Alignment**: Check if font sizes, weights, and colors match the project's design system or established patterns.
6. **Intent Audit**: Identify hardcoded "magic numbers", layout inconsistencies, or unusual offsets.

### PHASE 3: REMEDIATION
7. **Recommendations**: Provide a clear report of discrepancies and the exact CSS/Code fixes needed.
8. **Verification**: After applying changes, re-run 'caliper_inspect' or 'caliper_walk_and_measure' to confirm parity.

---
BEGIN PHASE 1 NOW. Do not skip any steps.`,
            },
          },
        ],
      })
    );

    this.server.registerPrompt(
      "caliper-selectors-compare",
      {
        description:
          "Compare two selections (A and B) to learn from A and fix B. Supports cross-tab comparisons.",
        argsSchema: {
          selectorA: z
            .string()
            .describe("Caliper Selector for the REFERENCE element (the 'good' one to learn from)"),
          selectorB: z
            .string()
            .describe("Caliper Selector for the TARGET element (the one to fix)"),
          tabIdA: z
            .string()
            .optional()
            .describe("Tab ID containing Selection A (use caliper_list_tabs to find IDs)"),
          tabIdB: z
            .string()
            .optional()
            .describe("Tab ID containing Selection B (defaults to same tab as A)"),
          properties: z
            .array(z.enum(["spacing", "typography", "colors", "layout", "all"]))
            .default(["all"])
            .describe("Which properties to compare"),
        },
      },
      async ({ selectorA, selectorB, tabIdA, tabIdB, properties }) => ({
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text: `## CALIPER SELECTORS COMPARISON

You are comparing TWO elements to understand the styling of one (A) and apply corrections to the other (B).

**Inputs:**
- Selection A (REFERENCE): \`${selectorA}\`${tabIdA ? ` in Tab: ${tabIdA}` : ""}
- Selection B (TARGET): \`${selectorB}\`${tabIdB ? ` in Tab: ${tabIdB}` : " (same tab as A)"}
- Properties to Compare: ${properties.join(", ")}

---

### IMPORTANT: TAB MANAGEMENT

${
  tabIdA || tabIdB
    ? `
You are working across multiple tabs. The agent-ID is **tab-specific** - if you send a command to the wrong tab, it will fail.

**Before Each Command:**
1. Use \`caliper_list_tabs\` to see all connected tabs
2. Use \`caliper_switch_tab\` to switch to the correct tab BEFORE calling walk/inspect
`
    : `
Both selections are on the SAME tab. No tab switching required.
`
}

### PHASE 1: WALK SELECTION A (REFERENCE)

${
  tabIdA
    ? `1. **Switch to Tab A**
   Call \`caliper_switch_tab\` with tabId: "${tabIdA}"

2. `
    : "1. "
}**Walk and Measure A**
   Call \`caliper_walk_and_measure\` with:
   - selector: "${selectorA}"
   - maxDepth: 3

   Record A's styles as the REFERENCE:
   ${properties.includes("all") || properties.includes("spacing") ? "- padding, margin, gap values" : ""}
   ${properties.includes("all") || properties.includes("typography") ? "- font-size, font-weight, line-height" : ""}
   ${properties.includes("all") || properties.includes("colors") ? "- background-color, color, border-color" : ""}
   ${properties.includes("all") || properties.includes("layout") ? "- display, flex-direction, justify-content, align-items" : ""}

### PHASE 2: WALK SELECTION B (TARGET)

${
  tabIdB
    ? `${tabIdA ? "3" : "2"}. **Switch to Tab B**
   Call \`caliper_switch_tab\` with tabId: "${tabIdB}"

${tabIdA ? "4" : "3"}. `
    : `${tabIdA ? "3" : "2"}. `
}**Walk and Measure B**
   Call \`caliper_walk_and_measure\` with:
   - selector: "${selectorB}"
   - maxDepth: 3

### PHASE 3: COMPARE AND ANALYZE

${tabIdB ? (tabIdA ? "5" : "4") : tabIdA ? "4" : "3"}. **Generate Comparison Report**
   For each property category, list:
   - Property name
   - Value in A (REFERENCE)
   - Value in B (TARGET)
   - Delta (difference)
   - Recommended fix for B

   Focus on making B match A's styling approach.

### PHASE 4: FIND SOURCE FOR B

${tabIdB ? (tabIdA ? "6" : "5") : tabIdA ? "5" : "4"}. **Locate B's Source**
   ${tabIdB ? `Switch back to Tab B if needed.` : ""}
   Use internal agent search (grep) with B's best anchor.
   Get the exact file path and line number.

### PHASE 5: APPLY FIXES TO B

${tabIdB ? (tabIdA ? "7" : "6") : tabIdA ? "6" : "5"}. **Generate CSS Fixes**
   Create CSS rules that will make B match A:
   \`\`\`css
   ${selectorB.startsWith("#") ? selectorB : `.${selectorB}`} {
     /* Fixes to match Selection A */
   }
   \`\`\`

${tabIdB ? (tabIdA ? "8" : "7") : tabIdA ? "7" : "6"}. **Edit Source File**
   Apply the CSS fixes to B's source file.

${tabIdB ? (tabIdA ? "9" : "8") : tabIdA ? "8" : "7"}. **Verify**
   Re-run \`caliper_walk_and_measure\` on B to confirm the fix.

---
**BEGIN PHASE 1 NOW. Remember to switch tabs before each walk command if working across tabs.**`,
            },
          },
        ],
      })
    );
  }

  async start() {
    try {
      await bridgeService.start(this.port);
    } catch (err) {
      logger.error("Bridge startup failed:", err);
    }

    try {
      const transport = new StdioServerTransport();
      await this.server.connect(transport);
      logger.info("Server running on STDIO transport");
    } catch (err) {
      logger.error("MCP Startup failed:", err);
      process.exit(1);
    }
  }

  async stop() {
    await bridgeService.stop();
    logger.info("Server stopped.");
  }
}
