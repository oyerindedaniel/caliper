import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { bridgeService } from "./bridge-service.js";
import { CaliperAgentState, CaliperNodeSchema, DesignTokenDictionarySchema, FrameworkSchema } from "@oyerinde/caliper-schema";
import { tabManager } from "./tab-manager.js";
import { semanticHarmonyReconciler } from "./semantic-harmony-reconciler.js";
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
        description: "Get full geometry, z-index, and computed visibility for an element.",
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
        description: "Perform a high-precision measurement between two elements.",
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
        description: `Perform precision reconciliation using the Semantic Harmony Engine.
Matches live DOM nodes to Figma design context with design token awareness.`,
        inputSchema: z.object({
          caliperTree: CaliperNodeSchema.describe("The measured DOM tree from caliper_walk_and_measure"),
          expectedHtml: z.string().describe("The EXPECTED HTML/JSX output from figma-mcp's get_design_context"),
          designTokens: DesignTokenDictionarySchema.describe("The design token dictionary from figma-mcp's get_variable_defs"),
          framework: FrameworkSchema.describe("The frontend framework/styling approach used (react-tailwind, html-css, etc.)"),
          figmaLayerUrl: z.string().describe("The URL of the Figma layer being reconciled"),
          secondaryHtml: z.string().optional().describe("HTML output for secondary breakpoint (optional)"),
          secondaryTokens: DesignTokenDictionarySchema.optional().describe("Design tokens for secondary breakpoint (optional)"),
        }),
      },
      async ({ caliperTree, expectedHtml, designTokens, framework, figmaLayerUrl, secondaryHtml, secondaryTokens }) => {
        try {
          const report = semanticHarmonyReconciler.reconcile({
            caliperTree,
            expectedHtml,
            designTokens,
            framework,
            figmaLayerUrl,
            secondaryHtml,
            secondaryTokens,
          });
          return { content: [{ type: "text", text: JSON.stringify(report, null, 2) }] };
        } catch (error) {
          return {
            content: [{ type: "text", text: `Semantic reconciliation failed: ${error instanceof Error ? error.message : String(error)}` }],
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
        description: "Semantic Harmony reconciliation: Figma design context to live DOM with token-aware diffing.",
        argsSchema: {
          selector: z.string().describe("Caliper Selector (Agent ID) of the root element"),
          figmaUrl: z.string().describe("Figma layer URL (primary breakpoint)"),
          framework: FrameworkSchema
            .default("react-tailwind")
            .describe("Your frontend framework/styling approach"),
          figmaSecondaryUrl: z.string().optional().describe("Figma layer URL (secondary breakpoint)"),
        },
      },
      async ({ selector, figmaUrl, framework, figmaSecondaryUrl }) => ({
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text: `## CALIPER-FIGMA SEMANTIC HARMONY RECONCILIATION

You are about to perform a **precision reconciliation** between a Figma design and its live DOM implementation using the Semantic Harmony Engine.

**Inputs:**
- Caliper Selector: \`${selector}\`
- Figma Layer URL: ${figmaUrl}
- Framework: ${framework}
${figmaSecondaryUrl ? `- Secondary Figma URL: ${figmaSecondaryUrl}` : ""}

---

### Phase 1: Context Gathering

1. **Capture Primary Context**
   - Call Figma MCP's \`get_design_context\` for: ${figmaUrl}
     Prompt: "${getFigmaPrompt(framework)}"
     **Keep the resulting HTML/JSX output.**
   - Call \`get_variable_defs\` for: ${figmaUrl}
     **Keep the design tokens dictionary.**

${figmaSecondaryUrl ? `2. **Capture Secondary Context (Responsive)**
   - Call \`get_design_context\` for: ${figmaSecondaryUrl}
     Prompt: "${getFigmaPrompt(framework)}"
   - Call \`get_variable_defs\` for: ${figmaSecondaryUrl}` : ""}

### Phase 2: Implementation Audit

${figmaSecondaryUrl ? "3" : "2"}. **Walk the DOM**
   Call \`caliper_walk_and_measure\` with:
   - selector: "${selector}"
   - maxDepth: 5
   **Keep the resulting CaliperNode tree.**

### Phase 3: Reconciliation Engine

${figmaSecondaryUrl ? "4" : "3"}. **Trigger Reconciliation**
   Call \`caliper_reconcile\` with:
   - caliperTree: (From Phase 2)
   - expectedHtml: (From context gathering)
   - designTokens: (From context gathering)
   - framework: "${framework}"
   - figmaLayerUrl: "${figmaUrl}"
${figmaSecondaryUrl ? `   - secondaryHtml: (From Phase 1, Step 2)
   - secondaryTokens: (From Phase 1, Step 2)` : ""}

   **Analyze the reconciliation report.** The Engine will have performed:
   
   1. **Semantic Matching**:
      - Parsed HTML into a semantic tree.
      - Matched nodes using hierarchical pairing with confidence scoring (tag match, text exact/fuzzy, layout structure).
   
   2. **Token-Aware Property Diffing**:
      - Compared **spacing**: padding, margin, and gap against design tokens.
      - Compared **typography**: font-size, font-weight, line-height.
      - Compared **visuals**: normalized colors (hex) and border-radius.
      - Generated CSS recommendations using **token names**:
        \`padding: var(--spacing-md); /* 16px */\`

   Identify major vs minor deltas and use matching confidence signals to prioritize fixes.

### Phase 4: Fix and Verify

${figmaSecondaryUrl ? "5" : "4"}. **Find Source Code**
   Use \`caliper_grep\` with identifiers from the report to find the target file.

${figmaSecondaryUrl ? "6" : "5"}. **Apply Fixes**
   Update the source code using the recommendations in the report.

${figmaSecondaryUrl ? "7" : "6"}. **Verify**
   Re-run \`caliper_walk_and_measure\` to confirm the fix.

---
**BEGIN PHASE 1 NOW. Complete all phases in order following all instructions precisely.**`,
            },
          },
        ],
      })
    );

    this.server.registerPrompt(
      "caliper-cross-compare",
      {
        description: "Compare two selections (A and B) to learn from A and fix B. Supports cross-tab comparisons.",
        argsSchema: {
          selectorA: z.string().describe("Caliper Selector for the REFERENCE element (the 'good' one to learn from)"),
          selectorB: z.string().describe("Caliper Selector for the TARGET element (the one to fix)"),
          tabIdA: z.string().optional().describe("Tab ID containing Selection A (use caliper_list_tabs to find IDs)"),
          tabIdB: z.string().optional().describe("Tab ID containing Selection B (defaults to same tab as A)"),
          properties: z.array(z.enum(["spacing", "typography", "colors", "layout", "all"]))
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
              text: `## CALIPER CROSS-SELECTION COMPARISON

You are comparing TWO elements to understand the styling of one (A) and apply corrections to the other (B).

**Inputs:**
- Selection A (REFERENCE): \`${selectorA}\`${tabIdA ? ` in Tab: ${tabIdA}` : ""}
- Selection B (TARGET): \`${selectorB}\`${tabIdB ? ` in Tab: ${tabIdB}` : " (same tab as A)"}
- Properties to Compare: ${properties.join(", ")}

---

### IMPORTANT: TAB MANAGEMENT

${tabIdA || tabIdB ? `
You are working across multiple tabs. The agent-ID is **tab-specific** - if you send a command to the wrong tab, it will fail.

**Before Each Command:**
1. Use \`caliper_list_tabs\` to see all connected tabs
2. Use \`caliper_switch_tab\` to switch to the correct tab BEFORE calling walk/inspect
` : `
Both selections are on the SAME tab. No tab switching required.
`}

### PHASE 1: WALK SELECTION A (REFERENCE)

${tabIdA ? `1. **Switch to Tab A**
   Call \`caliper_switch_tab\` with tabId: "${tabIdA}"

2. ` : "1. "}**Walk and Measure A**
   Call \`caliper_walk_and_measure\` with:
   - selector: "${selectorA}"
   - maxDepth: 3

   Record A's styles as the REFERENCE:
   ${properties.includes("all") || properties.includes("spacing") ? "- padding, margin, gap values" : ""}
   ${properties.includes("all") || properties.includes("typography") ? "- font-size, font-weight, line-height" : ""}
   ${properties.includes("all") || properties.includes("colors") ? "- background-color, color, border-color" : ""}
   ${properties.includes("all") || properties.includes("layout") ? "- display, flex-direction, justify-content, align-items" : ""}

### PHASE 2: WALK SELECTION B (TARGET)

${tabIdB ? `${tabIdA ? "3" : "2"}. **Switch to Tab B**
   Call \`caliper_switch_tab\` with tabId: "${tabIdB}"

${tabIdA ? "4" : "3"}. ` : `${tabIdA ? "3" : "2"}. `}**Walk and Measure B**
   Call \`caliper_walk_and_measure\` with:
   - selector: "${selectorB}"
   - maxDepth: 3

### PHASE 3: COMPARE AND ANALYZE

${tabIdB ? (tabIdA ? "5" : "4") : (tabIdA ? "4" : "3")}. **Generate Comparison Report**
   For each property category, list:
   - Property name
   - Value in A (REFERENCE)
   - Value in B (TARGET)
   - Delta (difference)
   - Recommended fix for B

   Focus on making B match A's styling approach.

### PHASE 4: FIND SOURCE FOR B

${tabIdB ? (tabIdA ? "6" : "5") : (tabIdA ? "5" : "4")}. **Locate B's Source**
   ${tabIdB ? `Switch back to Tab B if needed.` : ""}
   Call \`caliper_grep\` with B's best anchor.
   Get the exact file path and line number.

### PHASE 5: APPLY FIXES TO B

${tabIdB ? (tabIdA ? "7" : "6") : (tabIdA ? "6" : "5")}. **Generate CSS Fixes**
   Create CSS rules that will make B match A:
   \`\`\`css
   ${selectorB.startsWith("#") ? selectorB : `.${selectorB}`} {
     /* Fixes to match Selection A */
   }
   \`\`\`

${tabIdB ? (tabIdA ? "8" : "7") : (tabIdA ? "7" : "6")}. **Edit Source File**
   Apply the CSS fixes to B's source file.

${tabIdB ? (tabIdA ? "9" : "8") : (tabIdA ? "8" : "7")}. **Verify**
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

function getFigmaPrompt(framework: string): string {
  const isTailwind = framework.endsWith("-tailwind");
  const base = framework.split("-")[0];
  const frameworkName = base === "html" ? "plain HTML" : base === "react" ? "React" : base === "vue" ? "Vue" : "Svelte";
  const styling = isTailwind ? "with Tailwind CSS" : "with CSS classes and inline styles";

  return `generate my Figma selection in ${frameworkName} ${styling}`;
}
