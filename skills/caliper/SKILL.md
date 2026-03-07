---
name: caliper
description: High-precision layout audits and component tracing for design engineering. Use when asked to "audit spacing", "measure contrast", "verify styling", "fix layout shift", or "reconcile design".
metadata:
  author: oyerindedaniel
  version: "1.0.0"
  license: MIT
  type: agent-skill
  mcp-servers:
    - caliper
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

3. **Check for an active connection & Multi-Tab Auditing**
   - Call `caliper_list_tabs` to retrieve all connected browser instances.
   - **Identification**: Use the `title` and `url` fields to identify the target environment (e.g., "Dashboard" vs "Landing Page").
   - **Switching Context**: If multiple tabs are active, call `caliper_switch_tab({ tabId })` to focus your audit on the correct tab before proceeding.
   - **Status**: If the list is empty, the MCP server is active but cannot see the browser. Instruct the user to verify:
     - The web app is open in a browser tab.
     - The bridge is active in the code (see Step 2 snippet).
     - The port matches the [MCP Configuration](https://caliper.danieloyerinde.com/docs/agentic#mcp-server).

## 2. Element Targeting

If a user request is vague (e.g., "Check the header"), you should proactively choose a relevant selector to audit just to verify the layout. Follow this tiered priority:

1.  **Stable Markers**: (Highest Priority) Use `data-caliper-id` (caliperProps) found in the codebase.
2.  **Caliper Identifiers**: Use the **JSON Fingerprint** or **Agent ID** (`caliper-***`) provided by the user or discovered via the `caliper://state` resource.
3.  **Standard Selectors**: (Last Resort) Use raw CSS classes or IDs only if no stable markers are available.

## 3. Tool Details

### 3.1 The "Audit Loop" (Harness Flow)

> [!IMPORTANT]
> **Context First**: You MUST gather all required context (geometry, computed styles, and recursive child relationships) and perform a comprehensive analysis before making any code changes. Never attempt to "fix" an issue until the audit is 100% complete.

When asked to "audit a component," follow this precise loop:

1.  **Step 0: Context Gathering (Pre-flight)**: 
    - Call `caliper_inspect({ selector })` to retrieve metadata, `descendantCount`, and `sourceHints`.
    - Analyze the `descendantsTruncated` flag to determine if pagination is required.
2.  **Step 1: Recursive Walk (Data Capture)**: 
    - Call `caliper_walk_and_measure({ selector })`.
    - **Pagination Logic**: If `hasMore` is true, use the returned `continuationToken` in a subsequent call as the `continueFrom` parameter. Continue this loop until `hasMore` is false to ensure you have the *entire* component tree.
    - **Analysis**: Look for:
        - **Spacing Drift**: Gaps not matching the project's scale (e.g., 13px instead of 12px or 16px).
        - **Typography**: Inconsistent `lineHeight` or `fontWeight` among siblings.
        - **Layout Logic**: Elements using `absolute` positioning where `flex` or `grid` would be more stable.
3.  **Step 2: Trace (Source Discovery)**: 
    - Use `sourceHints` to map the rendered nodes to the codebase.
    - Look at `suggestedGrep`. This is a pre-built grep pattern to find exactly where that element is defined in the `.tsx` or `.html` files.
4.  **Step 3: Fix & Verify**: 
    - Only after Steps 0-2 are complete, apply the code change.
    - Re-call `caliper_inspect` or `caliper_walk_and_measure` to verify the new computed styles match the goal.

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

## 6. Usage Example

**User**: "The 'Submit' button on the login page looks like it has uneven padding."

**Agent**:
1.  **Observe**: Noticing the user is on `/login`. I subscribe to `caliper://state`.
2.  **Inspect**: I call `caliper_inspect({ selector: "button[type='submit']" })`. I see `descendantCount: 2`. No pagination needed.
3.  **Walk**: I call `caliper_walk_and_measure({ selector: "button[type='submit']" })`. 
    - **Result**: `padding-left: 16px`, `padding-right: 18px`.
4.  **Trace**: I use `sourceHints.suggestedGrep` (e.g., `"<button.*type='submit'"` ) to search the codebase. I discover the component in `src/components/LoginButton.tsx`.
5.  **Analyze**: Confirming the padding is indeed asymmetrical (16px vs 18px).
6.  **Fix**: I update `LoginButton.tsx` to use a consistent `px-4` (16px) tailwind class.
7.  **Verify**: I re-call `caliper_inspect` to confirm `padding-right` is now `16px`.
8.  **Respond**: "I've audited the 'Submit' button. It had a 2px padding imbalance (16px left vs 18px right). I've corrected it in `LoginButton.tsx` and verified the fix in the browser."
