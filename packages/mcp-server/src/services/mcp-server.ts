import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { bridgeService } from "./bridge-service.js";
import { CaliperAgentState } from "../schemas/bridge.js";
import { AuditNodeInputSchema, BrowserElementProps } from "../schemas/audit.js";
import { auditDesignVsBrowser } from "./audit-service.js";
import { tabManager } from "./tab-manager.js";
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
          primarySelector: z.string().describe("Caliper ID or CSS selector for the primary element"),
          secondarySelector: z.string().describe("Caliper ID or CSS selector for the target element"),
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
      "caliper_audit_node",
      {
        description: `[REQUIRES FIGMA MCP] Audit a browser element against Figma design properties. 
Use this ONLY when the user explicitly mentions "Figma" or when Figma MCP tools (get_metadata, get_variable_defs) have been called.
For general element inspection without Figma, use caliper_inspect instead.

Compares live implementation to design intent using one of three strategies:
- Strategy A (Container-First): Design frame is max boundary, element centers and shrinks on smaller viewports.
- Strategy B (Padding-Locked): Edge spacing is fixed, content fills available space.
- Strategy C (Ratio-Based): Element maintains proportional width relative to viewport.

NOTE: If the design has nested frames (Desktop Frame → Centered Container → Content), pass the INNER container's dimensions as frameWidth, not the outer frame.

Returns deltas and CSS recommendations to achieve pixel-perfect implementation.`,
        inputSchema: AuditNodeInputSchema,
      },
      async ({ selector, designProps, strategy, tolerance }) => {
        try {
          const inspectResult = await bridgeService.call("CALIPER_INSPECT", { selector });

          if (!inspectResult.success || inspectResult.intent !== "CALIPER_INSPECT") {
            return {
              content: [{ type: "text", text: `Error: Could not inspect element "${selector}". ${(inspectResult as any).error || "Element not found."}` }],
              isError: true,
            };
          }

          const result = inspectResult;

          const state = await bridgeService.call<CaliperAgentState>("CALIPER_GET_STATE", {});

          const browserProps: BrowserElementProps = {
            viewportWidth: state.viewport.width,
            viewportHeight: state.viewport.height,
            left: result.distances.left,
            top: result.distances.top,
            width: result.distances.horizontal,
            height: result.distances.vertical,
            paddingLeft: result.computedStyles.paddingLeft,
            paddingRight: result.computedStyles.paddingRight,
            paddingTop: result.computedStyles.paddingTop,
            paddingBottom: result.computedStyles.paddingBottom,
            marginLeft: result.computedStyles.marginLeft,
            marginRight: result.computedStyles.marginRight,
          };

          const auditResult = auditDesignVsBrowser(
            designProps,
            browserProps,
            strategy,
            tolerance ?? 1
          );

          return { content: [{ type: "text", text: JSON.stringify(auditResult, null, 2) }] };
        } catch (error) {
          return {
            content: [{ type: "text", text: `Error auditing element: ${error instanceof Error ? error.message : String(error)}` }],
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
          selector: z.string().describe("Caliper ID or CSS selector"),
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
          if (info.text) strategy.push(`Search for exact text: "${info.text}"`);
          if (info.tag) strategy.push(`Filter results by <${info.tag}> tag`);

          return {
            content: [{
              type: "text",
              text: JSON.stringify({
                parsed: info,
                recommendedKeywords: [info.id, info.text].filter(Boolean),
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
      "caliper-spacing-check",
      {
        description: "Analyze spacing and margin consistency between elements.",
        argsSchema: {
          component: z.string().describe("The name or selector of the component to audit"),
        },
      },
      async ({ component }) => ({
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text: `Check the spacing consistency for the '${component}' component. Measure the horizontal and vertical gaps between several instances of this component or its children using 'caliper_measure'. Document any deviations from a consistent grid or spacing system.`,
            },
          },
        ],
      })
    );

    this.server.registerPrompt(
      "caliper-figma-audit",
      {
        description: "Perform a pixel-perfect audit against a Figma design.",
        argsSchema: {
          layerName: z.string().describe("The name of the layer/component in Figma to audit"),
          selector: z.string().describe("The Caliper Selector (Agent ID) of the live element"),
          strategy: z.enum(["A", "B", "C"]).describe("A=Container, B=Padding, C=Ratio"),
        },
      },
      async ({ layerName, selector, strategy }) => ({
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text: `I want to perform a Pixel-Perfect audit for the '${layerName}' component against the browser element '${selector}' using Strategy '${strategy}'.
          
1. First, use Figma's 'get_metadata' tool to find the node and extract its absoluteBoundingBox (nodeX/Y, width, height) and its parent's dimensions.
2. If the design relies on spacing, use Figma's 'get_variable_defs' to find the design tokens.
3. Call 'caliper_audit_node' with:
   - selector: "${selector}"
   - designProps: (from Figma metadata)
   - strategy: "${strategy}"
4. Analyze the results. If there are deltas, use 'caliper_walk_dom' and 'caliper_grep' to find the exact source file implementing this element and its styles.
5. Apply the CSS recommendations provided by Caliper and verify the fix by re-auditing.`,
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

2. **Walk the DOM Tree**
   Call 'caliper_walk_dom' with selector: "${selector}"
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
  }

  async start() {
    try {
      bridgeService.start(this.port);
      const transport = new StdioServerTransport();
      await this.server.connect(transport);
      logger.info("Server running on STDIO transport");
    } catch (err) {
      logger.error("Startup failed:", err);
      process.exit(1);
    }
  }

  async stop() {
    await bridgeService.stop();
    logger.info("Server stopped.");
  }
}
