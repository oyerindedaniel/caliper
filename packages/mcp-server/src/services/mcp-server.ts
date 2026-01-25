import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { bridgeService } from "./bridge-service.js";
import { CaliperAgentState, CaliperNodeSchema, FigmaFrameContextSchema } from "@oyerinde/caliper-schema";
import { tabManager } from "./tab-manager.js";
import { reconcilerService } from "./reconciler-service.js";
import { createLogger } from "../utils/logger.js";
import { caliperGrep } from "../utils/grep.js";
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
} catch (_) {
}

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
        description: "Get full geometry, z-index, and computed visibility for an element. Use the 'selector' (Caliper ID) obtained from caliper_get_state for best results.",
        inputSchema: z.object({
          selector: z.string().describe("Caliper ID (caliper-xxxx) or CSS selector of the element"),
        }),
      },
      async ({ selector }) => {
        try {
          const result = await bridgeService.call("CALIPER_INSPECT", { selector });
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        } catch (error) {
          return {
            content: [{ type: "text", text: `Error inspecting element: ${error instanceof Error ? error.message : String(error)}` }],
            isError: true,
          };
        }
      }
    );

    this.server.registerTool(
      "caliper_measure",
      {
        description: "Perform a high-precision measurement between two elements. Use Caliper IDs (caliper-xxxx) obtained from caliper_get_state for best results.",
        inputSchema: z.object({
          primarySelector: z.string().describe("Caliper ID (caliper-xxxx) or CSS selector for the primary element"),
          secondarySelector: z.string().describe("Caliper ID (caliper-xxxx) or CSS selector for the target element"),
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
            content: [{ type: "text", text: `Error performing measurement: ${error instanceof Error ? error.message : String(error)}` }],
            isError: true,
          };
        }
      }
    );

    this.server.registerTool(
      "caliper_get_state",
      {
        description: "Get the current passive state of Caliper (viewport + significant elements only).",
        inputSchema: z.object({}),
      },
      async () => {
        try {
          const result = await bridgeService.call<CaliperAgentState>("CALIPER_GET_STATE", {});
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        } catch (error) {
          return {
            content: [{ type: "text", text: `Error getting state: ${error instanceof Error ? error.message : String(error)}` }],
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
            content: [{ type: "text", text: `Error clearing UI: ${error instanceof Error ? error.message : String(error)}` }],
            isError: true,
          };
        }
      }
    );

    this.server.registerTool(
      "caliper_grep",
      {
        description: "Optimized project search to find where a specific element or text is defined in the source code. Uses keywords from caliper_inspect or selection copy.",
        inputSchema: z.object({
          query: z.string().describe("Text, ID, or unique class to search for"),
          tag: z.string().optional().describe("Optional HTML tag to search for in combination with query (e.g., 'span', 'button')"),
        }),
      },
      async ({ query, tag }) => {
        const results = caliperGrep(query, process.cwd(), tag);
        return { content: [{ type: "text", text: JSON.stringify(results, null, 2) }] };
      }
    );

    this.server.registerTool(
      "caliper_walk_dom",
      {
        description: "Get the semantic context of an element by traversing its parents and children. Useful for understanding component hierarchy.",
        inputSchema: z.object({
          selector: z.string().describe("Caliper ID (caliper-xxxx) or CSS selector of the element"),
        }),
      },
      async ({ selector }) => {
        try {
          const result = await bridgeService.call("CALIPER_WALK_DOM", { selector });
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        } catch (error) {
          return {
            content: [{ type: "text", text: `DOM Walk failed: ${error instanceof Error ? error.message : String(error)}` }],
            isError: true,
          };
        }
      }
    );


    this.server.registerTool(
      "caliper_parse_selector",
      {
        description: "Break down the JSON selector info copied from Caliper and provide a code-search strategy.",
        inputSchema: z.object({
          selectorInfo: z.string().describe("The JSON selector info copied from Caliper UI"),
        }),
      },
      async ({ selectorInfo }) => {
        try {
          const info = JSON.parse(selectorInfo);
          const strategy: string[] = [];

          if (info.id) strategy.push(`Search for id="${info.id}"`);
          if (info.classes && info.classes.length > 0) strategy.push(`Search for class(es): .${info.classes.join(".")}`);
          if (info.text) strategy.push(`Search for exact text: "${info.text}"`);
          if (info.tag) strategy.push(`Filter results by <${info.tag}> tag`);

          const keywords = [info.id, ...(info.classes || []), info.text].filter(Boolean);

          return {
            content: [{
              type: "text",
              text: JSON.stringify({
                parsed: info,
                recommendedKeywords: Array.from(new Set(keywords)),
                strategy: strategy.join(" -> ")
              }, null, 2)
            }]
          };
        } catch (e) {
          return {
            content: [{ type: "text", text: "Invalid selector info JSON" }],
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
          selector: z.string().describe("Caliper ID or CSS selector of the root element to walk"),
          maxDepth: z.number().optional().describe("Maximum depth to walk (default: 5)"),
        }),
      },
      async ({ selector, maxDepth }) => {
        try {
          const result = await bridgeService.call("CALIPER_WALK_AND_MEASURE", {
            selector,
            maxDepth: maxDepth ?? 5
          });
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        } catch (error) {
          return {
            content: [{ type: "text", text: `Walk and Measure failed: ${error instanceof Error ? error.message : String(error)}` }],
            isError: true,
          };
        }
      }
    );

    this.server.registerTool(
      "caliper_reconcile",
      {
        description: `Perform high-precision reconciliation between Figma design intent and live implementation.

This tool:
1. Takes a measured Caliper tree (from caliper_walk_and_measure)
2. Takes Figma metadata (from Figma MCP get_metadata)
3. Pairs nodes based on ID, Text, and Structure
4. Applies A/B/C strategy audit logic
5. Generates consolidated base and responsive CSS fixes

Inputs:
- caliperTree: The measured tree from caliper_walk_and_measure
- figmaPrimary: Primary Figma frame context
- figmaSecondary: Optional tablet/mobile Figma frame context
- strategy: Reconciliation strategy (A=Container, B=Padding, C=Ratio)`,
        inputSchema: z.object({
          caliperTree: CaliperNodeSchema.describe("The root CaliperNode from walkResult"),
          figmaPrimary: FigmaFrameContextSchema.describe("FigmaFrameContext of the primary design"),
          figmaSecondary: FigmaFrameContextSchema.optional().describe("FigmaFrameContext of the secondary design"),
          strategy: z.enum(["A", "B", "C"]).default("A"),
        }),
      },
      async ({ caliperTree, figmaPrimary, figmaSecondary, strategy }) => {
        try {
          const report = reconcilerService.reconcile(
            caliperTree,
            figmaPrimary,
            figmaSecondary,
            strategy
          );
          return { content: [{ type: "text", text: JSON.stringify(report, null, 2) }] };
        } catch (error) {
          return {
            content: [{ type: "text", text: `Reconciliation failed: ${error instanceof Error ? error.message : String(error)}` }],
            isError: true,
          };
        }
      }
    );
  }

  private registerResources() {
    this.server.registerResource(
      "caliper-state",
      "caliper://state",
      { description: "The current real-time state of Caliper including viewport and significant element geometry." },
      async () => {
        const result = await bridgeService.call<CaliperAgentState>("CALIPER_GET_STATE", {});
        return {
          contents: [
            {
              uri: "caliper://state",
              mimeType: "application/json",
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }
    );

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
        description: "Perform a comprehensive audit of a specific selector, analyzing spacing, typography, colors, and layout consistency.",
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
              text: `Please perform a comprehensive audit for the element: '${selector}'.

1. **Deep Inspection**: Call 'caliper_inspect' to get all computed styles, colors, and typography.
2. **Hierarchy Walk**: Call 'caliper_walk_and_measure' to understand its position in the tree, its children, and the spacing (gaps) to its neighbors.
3. **Consistency Check**: 
   - Analyze if the padding and margins follow a consistent scale (e.g., multiples of 4px or 8px).
   - Check if font sizes, weights, and colors match the project's design system (if visible in other parts of the site).
   - Identify any hardcoded "magic numbers" or unusual offsets.
4. **Source Discovery**: Call 'caliper_grep' to find where these styles are defined.
5. **Recommendations**: Provide a clear report of discrepancies and the exact CSS fixes needed to improve consistency and quality.`,
            },
          },
        ],
      })
    );

    this.server.registerPrompt(
      "caliper-audit-harness",
      {
        description: "A structured context-gathering loop that MUST complete before any code edits. Prevents stale references from HMR.",
        argsSchema: {
          selector: z.string().describe("The Caliper Selector (Agent ID) of the element to audit"),
        },
      },
      async ({ selector }) => ({
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text: `## CALIPER AUDIT HARNESS

You are about to audit the element '${selector}'. Before making ANY code changes, you MUST complete the following context-gathering loop. This is critical because Caliper agent-IDs are dynamically generated and will be lost if HMR triggers.

### PHASE 1: GATHER CONTEXT (MANDATORY)

1. **Inspect the Element**
   Call 'caliper_inspect' with selector: "${selector}"
   Record: tagName, id, text content, computed styles

    2. **Deep Audit Walk**
       Call 'caliper_walk_and_measure' with selector: "${selector}" and maxDepth: 2
       Record:
       - Parent landmark (e.g., "nav", "main", "section#hero")
       - Children structure
       - Any unique identifiers (ids, data-testid, aria-label)

3. **Find Greppable Anchor**
   From steps 1-2, identify a STABLE identifier that will survive HMR:
   - Prefer: element ID, data-testid, unique text content, aria-label
   - Avoid: Caliper agent-id, dynamic CSS classes

4. **Search Codebase**
   Call 'caliper_grep' with the greppable anchor
   Record: exact file path and line number

### PHASE 2: VERIFY (MANDATORY)

5. **Confirm Location**
   State clearly:
   - "The element '${selector}' is defined in: [FILE]:[LINE]"
   - "Greppable anchor used: [ANCHOR]"

### PHASE 3: EDIT (ONLY AFTER PHASES 1-2)

6. **Make Changes**
   Only now may you edit the file identified in Phase 2.
   After editing, call 'caliper_inspect' again to verify the change.

---
BEGIN PHASE 1 NOW. Do not skip any steps.`,
            },
          },
        ],
      })
    );

    this.server.registerPrompt(
      "caliper-figma-reconcile",
      {
        description: "Comprehensive Figma-to-Implementation reconciliation using the harness walk engine. Captures full tree measurements before making any code changes.",
        argsSchema: {
          selector: z.string().describe("Caliper Selector (Agent ID) of the root element"),
          strategy: z.enum(["A", "B", "C"]).describe("A=Container-First, B=Padding-Locked, C=Ratio-Based"),
          figmaUrl: z.string().optional().describe("Figma layer URL (primary breakpoint)"),
          figmaSecondaryUrl: z.string().optional().describe("Figma layer URL (secondary breakpoint for responsive)"),
        },
      },
      async ({ selector, strategy, figmaUrl, figmaSecondaryUrl }) => ({
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text: `## CALIPER-FIGMA RECONCILIATION HARNESS

You are about to perform a pixel-perfect reconciliation between Figma design and live implementation.

**Inputs:**
- Selector: ${selector}
- Strategy: ${strategy} ${strategy === "A" ? "(Container-First: centered with max-width)" : strategy === "B" ? "(Padding-Locked: fixed edge spacing)" : "(Ratio-Based: proportional width)"}
${figmaUrl ? `- Primary Figma URL: ${figmaUrl}` : "- No Figma URL provided (standalone audit)"}
${figmaSecondaryUrl ? `- Secondary Figma URL: ${figmaSecondaryUrl}` : ""}

---

### PHASE 1: FETCH FIGMA DATA
${figmaUrl ? `1. Call Figma MCP's 'get_metadata' on: ${figmaUrl}
   Extract: frameWidth, nodeWidth, nodeX, paddingLeft, paddingRight
2. Call Figma MCP's 'get_variable_defs' on the selection.
   Extract: Design tokens (colors, spacing, typography variables) used in the design.
` : "Skip - no Figma URL provided"}
${figmaSecondaryUrl ? `3. Call Figma MCP's 'get_metadata' and 'get_variable_defs' on: ${figmaSecondaryUrl}
   Extract: secondary breakpoint dimensions and variables` : ""}

### PHASE 2: WALK AND MEASURE (MANDATORY)
4. Call 'caliper_walk_and_measure' with:
   - selector: "${selector}"
   - maxDepth: 3

   This captures the FULL implementation tree including:
   - All computed styles (padding, margin, gap, typography)
   - Sibling gaps and parent distances
   - Recursive structure

### PHASE 3: COMPARE
5. Compare the walkResult to Figma data:
   - Check padding values against Figma's padding
   - Check width against Figma's nodeWidth
   - Check sibling gaps against Figma's itemSpacing
   - Apply Strategy ${strategy} logic for alignment validation

### PHASE 4: FIND SOURCE
6. Call 'caliper_grep' with the best anchor from the walkResult:
   - Prefer: htmlId, unique textContent, data-testid
   Get the file path and line number.

### PHASE 5: APPLY EDITS (ONLY AFTER PHASES 1-4)
7. Generate CSS recommendations based on deltas found.
8. Edit the identified source file.
9. Re-run 'caliper_walk_and_measure' to verify the fix.

---
**BEGIN PHASE 1 NOW. Do not skip any steps.**`,
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
