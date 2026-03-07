---
name: caliper
description: Official Caliper Agent Skill. Teaches AI agents how to perform high-precision layout audits, component tracing, and design-to-code reconciliation using the Caliper MCP server. Use when asked to "audit", "measure", "verify styling", or "fix layout".
metadata:
  author: oyerindedaniel
  version: "1.0.0"
  type: agent-skill
---

# Caliper: Precision Design Engineering

This skill transforms you into a precision design engineer. You will use the Caliper MCP server to "see" the live browser, measure pixel-perfect gaps, and map rendered elements directly back to the user's source code.

### Capabilities
- **High-Precision Auditing**: Measure pixel-perfect spacing, geometry, and alignment.
- **Color Verification**: Calculate WCAG contrast ratios and Delta E perceptual differences.
- **Source Tracing**: Map rendered browser elements directly to specific source code lines.
- **Passive Observation**: Monitor user selections in real-time via the `caliper://state` resource.

## 1. Environment Setup & Verification

> [!IMPORTANT]
> **Limitation**: Caliper requires an active browser tab connected via the Agent Bridge. It **cannot** audit static screenshots or design files (Figma/Sketch) without a live rendered URL.

Perform these checks to ensure Caliper is active before start auditing:

1. **Check if Caliper is already active**
   - Search for `init({ bridge: { enabled: true } })` or a `<script src=".../caliper">` tag with `data-config`.
   - If found: Skip to connection check (Step 3).

2. **If missing, check for installation vs. setup**
   - **Step A (Check Library Presence)**: Verify `@oyerinde/caliper` in `package.json`.
   - **Step B (Determine Action)**:
     - If in `package.json` but not active: Propose the module `init()` snippet below.
     - If entirely missing: Propose the **CDN Script** (Zero-install, Universal) or package installation for module-based projects.
   - **Reference Implementations:**
     - **Option 1: Vanilla / Global Script (Recommended for Quick Start)**
       ```html
       <script src="https://unpkg.com/@oyerinde/caliper/dist/index.global.js" data-config='{"bridge": {"enabled": true}}'></script>
       ```
     - **Option 2: Module-based (React/Vite/etc)**
       ```ts
       import { init } from "@oyerinde/caliper";
       init({ bridge: { enabled: true } });
       ```
   - Documentation: [Agentic Installation](https://caliper.danieloyerinde.com/docs/agentic#installation).

3. **Check for an active connection**
   - Call `caliper_list_tabs`.
   - If empty: The MCP server is active but cannot see the browser. Instruct the user to verify:
     - The web app is open in a browser tab.
     - The bridge is active in the code (see Step 2 snippet).
     - The port matches the [MCP Configuration](https://caliper.danieloyerinde.com/docs/agentic#mcp-server).

## 2. Advanced Targeting (Caliper Selectors)

Never rely on fragile CSS classes alone. Caliper provides stable identifiers:

- **JSON Fingerprint**: (Preferred) Example: `{"agentId":"caliper-a1b2","tag":"div"}`.
- **Agent ID**: (`caliper-***`) Stable across re-renders.
- **caliperProps**: If you see `data-caliper-id` in the code, use that selector.

## 3. Tool Mastery & Intense Details

### 3.1 The "Audit Loop" (Harness Flow)

When asked to "audit a component," follow this precise loop:

1.  **Inspect (Pre-flight)**: Call `caliper_inspect({ selector })`. 
    *   **Crucial**: Analyze the returned `descendantCount` and `descendantsTruncated` flag.
    *   Compare these against the "Pagination Threshold" mentioned in the `caliper_inspect` tool description to decide if a single walk is safe.
2.  **Walk (Data Capture)**: Call `caliper_walk_and_measure({ selector })`.
    *   If the previous inspection indicated a large tree, use the `maxNodes` parameter to initiate pagination, following the batch size recommended in the tool documentation.
    *   Analyze the returned tree for:
        *   **Spacing Drift**: Gaps not matching the project's scale (e.g., 13px instead of 12px or 16px).
        *   **Typography**: Inconsistent `lineHeight` or `fontWeight` among siblings.
        *   **Layout Logic**: Elements using `absolute` positioning where `flex` or `grid` would be more stable.
3.  **Trace (Source Discovery)**: Use `sourceHints` from step 1.
    *   Look at `suggestedGrep`. This is a pre-built grep pattern to find exactly where that element is defined in the `.tsx` or `.html` files.
4.  **Fix & Verify**: Apply the code change, then re-call `caliper_inspect` to verify the new computed styles match the goal.

### 3.2 Color & Perceptual Audit

Don't just check hex codes; check **intent** and **accessibility**.

- **Contrast**: `caliper_check_contrast({ foreground, background })`. 
    *   Goal: AA (4.5:1) for normal text, 3:1 for large text.
- **Token Accuracy**: `caliper_delta_e({ color1, color2 })`. 
    *   Use this to see if a rendered "blue" is "close enough" to a design token. 
    *   Delta E < 0.05 is an acceptable match. 
    *   Delta E > 0.1 means they are likely using the wrong token or a hardcoded value.

### 3.3 Physical Measurement

When comparing two separate elements (e.g., "Is the sidebar really 20px from the header?"):
1.  Use `caliper_measure({ primarySelector, secondarySelector })`.
2.  It returns the edge-to-edge distances (`top-to-bottom`, `left-to-right`, etc.).

## 4. Resource: `caliper://state`

**Subscribe to this resource to passively observe the user.** It provides a real-time stream of the user's browser activity.

- **Event Trigger**: When the user Cmd/Ctrl + Clicks an element, `caliper://state` updates with a `selectionFingerprint`.
- **Primary Selector Source**: Use the `selectionFingerprint.selector` from this resource as your first choice for any tool input. Do not force the user to provide a CSS selector if they have already made a selection in the UI.
- **Proactive Context**: If you receive a resource update, acknowledge it immediately: *"I see you've selected the [tag] in the browser. Shall I perform a layout audit on it?"*

## 5. Reporting Format

Always report findings with:
- **Element**: The selector and the traced source file/line.
- **Actual vs Expected**: The measured value vs the design system goal.
- **Recommendation**: The exact CSS/Style fix required.
- **Verification**: A confirmation that you have re-measured after the fix.
