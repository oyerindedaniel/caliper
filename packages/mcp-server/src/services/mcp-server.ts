import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  MAX_DESCENDANT_COUNT,
  RECOMMENDED_PAGINATION_THRESHOLD,
  CALIPER_METHODS,
  CALIPER_ENGINE_METHODS,
  type CaliperAgentState,
  type CaliperMeasurementRouting,
} from "@oyerinde/caliper-schema";
import { bridgeService } from "./bridge-service.js";
import { createMeasurementService, type MeasurementService } from "./measurement-service.js";
import { tabManager } from "./tab-manager.js";
import { createLogger } from "../utils/logger.js";
import { parseColor, calculateDeltaE, calculateContrastRatio } from "../utils/color-utils.js";
import { DEFAULT_BRIDGE_PORT } from "../shared/constants.js";
import { BRIDGE_EVENTS } from "../shared/events.js";

const logger = createLogger("mcp-server");
export type CaliperMcpServerOptions = {
  port?: number;
  engineUrl?: string | null;
  engineTargetUrl?: string | null;
  runtimeRouting?: CaliperMeasurementRouting;
};

export class CaliperMcpServer {
  private server: McpServer;
  private port: number;
  private measurementService: MeasurementService;
  private lastState: CaliperAgentState | null = null;

  constructor(options: CaliperMcpServerOptions = {}) {
    this.port = options.port ?? DEFAULT_BRIDGE_PORT;
    this.measurementService = createMeasurementService({
      bridgePort: this.port,
      engineUrl: options.engineUrl ?? null,
      engineTargetUrl: options.engineTargetUrl ?? null,
      runtimeRouting: options.runtimeRouting,
    });
    this.server = new McpServer({
      name: "caliper-mcp-server",
      version: process.env.VERSION as string,
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
        description: `Get full geometry and computed visibility for an element.

Returns comprehensive element data including:
- distances: Position relative to viewport edges
- computedStyles: All CSS computed values
- selection: Scroll hierarchy and sticky configuration
- immediateChildCount: Direct children count
- descendantCount: Total descendants (capped at ${MAX_DESCENDANT_COUNT})
- descendantsTruncated: True if descendant count was capped
- sourceHints: Metadata for code discovery. Includes:
    * suggestedGrep: A reliable pattern for finding this element in the codebase.
    * stableAnchors: Prioritized list of stable attributes (data-testid, id, etc.).
    * textContent: Truncated direct text content.
    * unstableClasses: Classes that look like generated/hashed strings (to be ignored).

Use descendantCount to decide whether to paginate caliper_walk_and_measure.
If descendantCount > ${RECOMMENDED_PAGINATION_THRESHOLD} or descendantsTruncated is true, use maxNodes parameter.`,
        inputSchema: z.object({
          selector: z
            .string()
            .describe(
              "Element identifier. PRIORITIZE JSON Fingerprint, Caliper Agent ID (caliper-***), or CSS selector for maximum stabilization."
            ),
        }),
      },
      async ({ selector }) => {
        try {
          const result = await this.measurementService.call(CALIPER_METHODS.INSPECT, { selector });
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
            .describe(
              "Identifier for the primary element. PRIORITIZE JSON Fingerprint, Caliper Agent ID (caliper-***), or CSS selector."
            ),
          secondarySelector: z
            .string()
            .describe(
              "Identifier for the target element. PRIORITIZE JSON Fingerprint, Caliper Agent ID (caliper-***), or CSS selector."
            ),
        }),
      },
      async ({ primarySelector, secondarySelector }) => {
        try {
          const result = await this.measurementService.call(CALIPER_METHODS.MEASURE, {
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
          const result = await this.measurementService.call(CALIPER_METHODS.CLEAR, {});
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
            .describe(
              "Element identifier. PRIORITIZE JSON Fingerprint, Caliper Agent ID (caliper-***), or CSS selector for maximum stabilization."
            ),
        }),
      },
      async ({ selector }) => {
        try {
          const result = await this.measurementService.call(CALIPER_METHODS.WALK_DOM, { selector });
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
 
SAFETY: Calling 'caliper_inspect' is REQUIRED before initiating an initial audit on a component. This provides the 'descendantCount' metrics needed to set 'maxNodes' and avoid timeouts. You may skip 'inspect' only when resuming an audit using a 'continuationToken'.
 
STYLE PRUNING: To reduce payload size, default styles are omitted. If a style is missing, assume:
- display: "block"
- visibility: "visible"
- position: "static"
- boxSizing: "border-box"
- padding/margin/border: { top: 0, right: 0, bottom: 0, left: 0 }
- gap: 0
- flexDirection: "row" (flex only)
- justifyContent: "normal" (flex only)
- alignItems: "normal" (flex only)
- lineHeight: "normal"
- letterSpacing: "normal"
- backgroundColor: "rgba(0, 0, 0, 0)" (transparent)
- borderRadius: "0px"
- boxShadow: "none"
- opacity: 1
- overflow/overflowX/overflowY: "visible"

The output includes:
- root: The full measured tree (recursive CaliperNode structure)
- nodeCount: Total nodes captured
- maxDepthReached: Deepest level reached
- walkDurationMs: Time taken to complete the walk
- hasMore: Whether tree was truncated (pagination)
- continuationToken: Selector to resume from (if hasMore is true)
- batchInstructions: Guidance for next batch call (if hasMore is true)`,
        inputSchema: z.object({
          selector: z
            .string()
            .describe(
              "Root element identifier. PRIORITIZE JSON Fingerprint, Caliper Agent ID (caliper-***), or CSS selector for maximum stabilization."
            ),
          maxDepth: z.number().optional().describe("Maximum depth to walk (default: 5)"),
          maxNodes: z
            .number()
            .optional()
            .describe(
              "Maximum nodes to return per batch (default: unlimited). Use for large trees."
            ),
          continueFrom: z
            .string()
            .optional()
            .describe("Continuation token from previous call to resume pagination"),
          minElementSize: z
            .number()
            .optional()
            .describe(
              "Minimum element size (width/height) to include in the walk (default: 0). Use to filter out icons or tiny decorative elements."
            ),
          ignoreSelectors: z
            .array(z.string())
            .optional()
            .describe("List of CSS selectors or Agent IDs to skip during the walk."),
        }),
      },
      async ({ selector, maxDepth, maxNodes, continueFrom, minElementSize, ignoreSelectors }) => {
        try {
          const auditResult = await this.measurementService.call(CALIPER_METHODS.WALK_AND_MEASURE, {
            selector,
            maxDepth: maxDepth ?? 5,
            maxNodes,
            continueFrom,
            minElementSize,
            ignoreSelectors,
          });

          if (!auditResult.success) {
            return {
              content: [{ type: "text", text: `Walk and Measure failed: ${auditResult.error}` }],
              isError: true,
            };
          }

          let reportContent = JSON.stringify(auditResult);

          if (auditResult.walkResult.hasMore && auditResult.walkResult.batchInstructions) {
            reportContent = `${auditResult.walkResult.batchInstructions}\n\n${reportContent}`;
          }

          return { content: [{ type: "text", text: reportContent }] };
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
          const result = await this.measurementService.call(CALIPER_METHODS.GET_CONTEXT, {});
          const payload = result.success
            ? {
                ...result,
                runtimeConnection: this.measurementService.getRuntimeConnection(),
              }
            : result;
          return { content: [{ type: "text", text: JSON.stringify(payload) }] };
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
      "caliper_set_viewport",
      {
        description:
          "Set the emulated viewport for engine-mode audits. Requires MCP started with --runtime engine --engine.",
        inputSchema: z.object({
          width: z.number().int().positive().describe("Viewport width in CSS pixels"),
          height: z
            .number()
            .int()
            .positive()
            .optional()
            .describe("Viewport height in CSS pixels (default 812)"),
          deviceScaleFactor: z
            .number()
            .positive()
            .optional()
            .describe("Device pixel ratio override (default 1)"),
        }),
      },
      async ({ width, height, deviceScaleFactor }) => {
        try {
          const result = await this.measurementService.callEngine(
            CALIPER_ENGINE_METHODS.SET_VIEWPORT,
            {
              width,
              height,
              deviceScaleFactor,
            }
          );
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        } catch (error) {
          return {
            content: [
              {
                type: "text",
                text: `Set viewport failed: ${error instanceof Error ? error.message : String(error)}`,
              },
            ],
            isError: true,
          };
        }
      }
    );

    this.server.registerTool(
      "caliper_audit_breakpoints",
      {
        description:
          "Audit an element at viewport widths derived from page @media rules (plus optional explicit widths). Returns visibility and geometry at each width.",
        inputSchema: z.object({
          selector: z.string().describe("CSS selector or caliper agent id"),
          widths: z
            .array(z.number().int().positive())
            .optional()
            .describe("Explicit viewport widths to audit"),
          height: z.number().int().positive().optional().describe("Viewport height for each step"),
        }),
      },
      async ({ selector, widths, height }) => {
        try {
          const result = await this.measurementService.callEngine(
            CALIPER_ENGINE_METHODS.AUDIT_BREAKPOINTS,
            {
              selector,
              widths,
              height,
            }
          );
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        } catch (error) {
          return {
            content: [
              {
                type: "text",
                text: `Breakpoint audit failed: ${error instanceof Error ? error.message : String(error)}`,
              },
            ],
            isError: true,
          };
        }
      }
    );

    this.server.registerTool(
      "caliper_engine_get_runtime",
      {
        description:
          "Read console messages, uncaught exceptions, browser logs, and failed network requests from the caliper-engine tab. Use when the user asks to check logs or debug runtime errors. Call caliper_engine_clear_runtime before a repro if you need a clean window.",
        inputSchema: z.object({}),
      },
      async () => {
        try {
          const result = await this.measurementService.callEngine(
            CALIPER_ENGINE_METHODS.GET_RUNTIME,
            {}
          );
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        } catch (error) {
          return formatEngineToolError("Get runtime", error);
        }
      }
    );

    this.server.registerTool(
      "caliper_engine_clear_runtime",
      {
        description:
          "Clear caliper-engine runtime buffers (console, exceptions, logs, network failures). Call before reproducing an issue, then use caliper_engine_get_runtime after.",
        inputSchema: z.object({}),
      },
      async () => {
        try {
          const result = await this.measurementService.callEngine(
            CALIPER_ENGINE_METHODS.CLEAR_RUNTIME,
            {}
          );
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        } catch (error) {
          return formatEngineToolError("Clear runtime", error);
        }
      }
    );

    this.server.registerTool(
      "caliper_engine_scroll",
      {
        description:
          "Scroll the caliper-engine page to an absolute scroll position. Requires MCP started with --runtime engine --engine.",
        inputSchema: z.object({
          scrollX: z.number().optional().describe("Horizontal scroll position in CSS pixels"),
          scrollY: z.number().optional().describe("Vertical scroll position in CSS pixels"),
        }),
      },
      async ({ scrollX, scrollY }) => {
        try {
          const result = await this.measurementService.callEngine(CALIPER_ENGINE_METHODS.SCROLL, {
            scrollX,
            scrollY,
          });
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        } catch (error) {
          return formatEngineToolError("Scroll", error);
        }
      }
    );

    this.server.registerTool(
      "caliper_engine_scroll_into_view",
      {
        description:
          "Scroll the caliper-engine page until the target selector is in view. Requires engine mode.",
        inputSchema: z.object({
          selector: z.string().describe("CSS selector or caliper agent id"),
        }),
      },
      async ({ selector }) => {
        try {
          const result = await this.measurementService.callEngine(
            CALIPER_ENGINE_METHODS.SCROLL_INTO_VIEW,
            { selector }
          );
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        } catch (error) {
          return formatEngineToolError("Scroll into view", error);
        }
      }
    );

    this.server.registerTool(
      "caliper_engine_pause_animations",
      {
        description:
          "Pause CSS and Web Animations on the caliper-engine page. Pair with caliper_engine_resume_animations when finished.",
        inputSchema: z.object({}),
      },
      async () => {
        try {
          const result = await this.measurementService.callEngine(
            CALIPER_ENGINE_METHODS.PAUSE_ANIMATIONS,
            {}
          );
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        } catch (error) {
          return formatEngineToolError("Pause animations", error);
        }
      }
    );

    this.server.registerTool(
      "caliper_engine_resume_animations",
      {
        description: "Restore animation playback on the caliper-engine page after pausing.",
        inputSchema: z.object({}),
      },
      async () => {
        try {
          const result = await this.measurementService.callEngine(
            CALIPER_ENGINE_METHODS.RESUME_ANIMATIONS,
            {}
          );
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        } catch (error) {
          return formatEngineToolError("Resume animations", error);
        }
      }
    );

    this.server.registerTool(
      "caliper_engine_screenshot",
      {
        description:
          "Capture a PNG screenshot of the caliper-engine page. Returns a loopback URL to the image file.",
        inputSchema: z.object({
          fullPage: z.boolean().optional().describe("Capture the full scrollable page"),
          format: z.enum(["png", "jpeg"]).optional().describe("Image format (default png)"),
        }),
      },
      async ({ fullPage, format }) => {
        try {
          const result = await this.measurementService.callEngine(
            CALIPER_ENGINE_METHODS.SCREENSHOT,
            {
              fullPage,
              format,
            }
          );
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        } catch (error) {
          return formatEngineToolError("Screenshot", error);
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

    this.server.registerResource(
      "caliper-runtime",
      "caliper://runtime",
      {
        description:
          "Active Caliper runtime connection: attached bridge tab vs engine sandbox, routing mode, and engine health URL.",
      },
      async () => {
        const runtimeConnection = this.measurementService.getRuntimeConnection();
        return {
          contents: [
            {
              uri: "caliper://runtime",
              mimeType: "application/json",
              text: JSON.stringify(runtimeConnection, null, 2),
            },
          ],
        };
      }
    );

    this.server.registerResource(
      "caliper-state",
      "caliper://state",
      {
        description: `Provides a real-time stream of the active browser environment. This is your primary source for "listening" to what the user is doing. 
        
        It contains:
        - viewport: Current scroll positions and dimensions.
        - activeSelection: Visual metadata of the currently selected element.
        - selectionFingerprint: A stable JSON identifier (agentId, tag, text content) for the active selection. Use the 'selector' property from this object as input for 'caliper_inspect' or 'caliper_walk_and_measure' to perform high-precision audits on what the user just picked.
        - lastMeasurement & measurementFingerprint: Context for the most recent distance measurement between two elements.
        
        USE CASE: When you receive a notification that this resource has updated, read it to understand the user's current focus. If a 'selectionFingerprint' is present, you can immediately offer to 'Inspect' or 'Audit' that element without asking the user for a selector.`,
      },
      async () => {
        return {
          contents: [
            {
              uri: "caliper://state",
              mimeType: "application/json",
              text: JSON.stringify(this.lastState, null, 2),
            },
          ],
        };
      }
    );

    bridgeService.on(BRIDGE_EVENTS.STATE, (state: CaliperAgentState) => {
      this.lastState = state;
      this.server.server.sendResourceUpdated({ uri: "caliper://state" }).catch((error) => {
        logger.warn("Failed to notify resource update", error);
      });
    });
  }

  private registerPrompts() {
    this.server.registerPrompt(
      "caliper-selector-audit",
      {
        description:
          "Perform a comprehensive, structured audit of a specific selector: from source discovery to precision styling analysis.",
        argsSchema: {
          selector: z
            .string()
            .describe(
              "The Caliper Selector (JSON Fingerprint, Caliper Agent ID (caliper-***), or CSS selector) to audit. PRIORITIZE JSON Fingerprint for maximum stabilization."
            ),
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
1. **Deep Inspection**: Call 'caliper_inspect' to get all computed styles, colors, typography, and **sourceHints**.
2. **Hierarchy Walk**: Call 'caliper_walk_and_measure' with maxDepth: 5 to understand its position in the tree, its children, and the spacing (gaps) to its neighbors.
3. **Source Discovery**: Use the \`suggestedGrep\` from \`sourceHints\` (or another stable anchor) to locate the exact source file and line number in the codebase.

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
            .describe(
              "Caliper Selector for the REFERENCE element. PRIORITIZE JSON Fingerprint, Caliper Agent ID (caliper-***), or CSS selector for stabilization."
            ),
          selectorB: z
            .string()
            .describe(
              "Caliper Selector for the TARGET element. PRIORITIZE JSON Fingerprint, Caliper Agent ID (caliper-***), or CSS selector for stabilization."
            ),
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
   - maxDepth: 5

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
   - maxDepth: 5

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
      await this.measurementService.start();
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
    await this.measurementService.stop();
    logger.info("Server stopped.");
  }
}

function formatEngineToolError(action: string, error: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: `${action} failed: ${error instanceof Error ? error.message : String(error)}`,
      },
    ],
    isError: true,
  };
}
