---
name: caliper
description: High-precision layout audits and component tracing for design engineering. Use when asked to "audit spacing", "measure contrast", "verify styling", "fix layout shift", or "reconcile design".
metadata:
  author: oyerindedaniel
  version: "1.1.0"
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
> **Limitation**: Caliper measures the **live DOM runtime**. It cannot audit static screenshots or design files (Figma/Sketch) directly. Your application **must be actively running** in a browser tab with an active Agent Bridge connection.

Perform these checks to ensure Caliper is active before start auditing:

1. **Check if Caliper is already active**
   - Search for `init({}, [CaliperBridge({ enabled: true })])` or a `<script src=".../caliper">` tag with `data-config`.
   - If found: Skip to connection check (Step 3).

2. **If missing, check for installation vs. setup**
   - **Step A (Check Library Presence)**: 
     - Search for `@oyerinde/caliper` in `package.json`.
     - Search for `<script src=".../caliper">` tags in `index.html`, `layout.tsx`, or root template files.
   - **Step B (Determine Action)**:
     - If library is present (package or script) but not active: Propose the initialization snippet below.
     - If entirely missing: Propose the **CDN Script** (Zero-install, Universal) or package installation for module-based projects.
       - **Package Manager Detection**: Identify the correct installer by checking for lockfiles:
         - `pnpm-lock.yaml` -> Use `pnpm add -D @oyerinde/caliper`
         - `yarn.lock` -> Use `yarn add -D @oyerinde/caliper`
         - `bun.lockb` or `bun.lock` -> Use `bun add -d @oyerinde/caliper`
         - `package-lock.json` or none -> Use `npm install -D @oyerinde/caliper`
   - **Reference Implementations:**
     - **Option 1: Vanilla / Global Script (Recommended for Quick Start)**
       ```html
       <script src="https://unpkg.com/@oyerinde/caliper/dist/index.global.js" data-config='{"bridge": {"enabled": true}}'></script>
       ```
     - **Option 2: Module-based (React/Vite/etc)**
       ```ts
       import { init, CaliperBridge } from "@oyerinde/caliper/preset";
       
       init({
         theme: { primary: "#18a0fb" }
       }, [
         CaliperBridge({ enabled: true })
       ]);
       ```
   - Documentation: [Agentic Installation](https://caliper.danieloyerinde.com/docs/agentic#installation).

3. **Check for an active connection & Multi-Tab Auditing**
   - Call `caliper_list_tabs` to retrieve all connected browser instances.
   - **Identification**: Use the `title` and `url` fields to identify the target environment (e.g., "Dashboard" vs "Landing Page").
   - **Switching Context**: If multiple tabs are active, call `caliper_switch_tab({ tabId })` to focus your audit on the correct tab before proceeding.
   - **Status**: If the list is empty, the MCP server is active but cannot see the browser. Instruct the user to verify:
     - The web app is open in a browser tab.
     - The bridge is active in the code (see Step 2 snippet).
     - **Port Verification**: Check the code for a custom `wsPort` (default is 9876). If found, ensure the MCP server is configured with that same port using the `-p` or `--port` flag.

### 1.4 Production Safety

> [!IMPORTANT]
> Caliper is a development-only tool. You MUST advise the user to wrap the initialization in an environment check to prevent it from leaking into production bundles.

**Next.js / Vite / Modern Bundlers:**
```tsx
{process.env.NODE_ENV === "development" && (
  <Script src="..." /> // or init(...)
)}
```

**Vanilla HTML / CDN:**
```html
<script>
  if (location.hostname === "localhost" || location.hostname === "127.0.0.1") {
    // Add the global script tag here
    // <script src="..." data-config='{"bridge": {"enabled": true}}'></script>
  }
</script>
```

## 2. Element Targeting

If a user request is vague (e.g., "Check the header"), you should proactively choose a relevant selector to audit just to verify the layout. Follow this tiered priority:

1.  **Stable Markers**: (Highest Priority) Use `data-caliper-id` (caliperProps) found in the codebase.
2.  **Caliper Identifiers**: Use the **JSON Fingerprint** or **Agent ID** (`caliper-***`) provided by the user or discovered via the `caliper://state` resource.
3.  **Standard Selectors**: (Last Resort) Use raw CSS classes or IDs only if no stable markers are available.

> [!TIP]
> **Ignored Elements**: If a selector fails, check if the element or its parent has the `data-caliper-ignore` attribute. Caliper's engine will skip these by design.

## 3. Tool Details

### 3.1 The "Audit Loop" (Harness Flow)

> [!IMPORTANT]
> **Context First**: You MUST gather all required context (geometry, computed styles, and recursive child relationships) and perform a comprehensive analysis before making any code changes. Never attempt to "fix" an issue until the audit is 100% complete.

When asked to "audit a component," follow this precise loop:

1.  **Step 0: Context Gathering (Pre-flight)**: 
    - **Identify Target**: Locate the element using `caliper://state` or persistent context.
    - **Cleanup (Optional)**: If this is a *fresh* audit on a new component, call `caliper_clear` to remove stale visual markers. **Rule**: SKIP cleanup during iterative "fix it" loops or when the user says you're "not getting it", so the visual history remains visible.
    - **Environment Context**: Call `caliper_get_context()` to retrieve current viewport dimensions and scroll state. This is vital for debugging responsive issues.
    - Call `caliper_inspect({ selector })` to retrieve metadata, `descendantCount`, and `sourceHints`.
    - Analyze the `descendantsTruncated` flag to determine if pagination is required.
2.  **Step 1: Recursive Walk (Data Capture)**: 
    - Call `caliper_walk_and_measure({ selector })`.
    - **Pagination Logic**: If `hasMore` is true, use the returned `continuationToken` in a subsequent call as the `continueFrom` parameter. Continue this loop until `hasMore` is false to ensure you have the *entire* component tree.
    - **Analysis**: Look for:
        - **Spacing Drift**: Gaps not matching the project's scale (e.g., 13px instead of 12px or 16px). **Note**: Observe sub-pixel geometry (e.g., 12.33px); these are often intentional for sub-pixel anti-aliasing or indicators of parent grid/flex miscalculations.
        - **Typography**: Inconsistent `lineHeight` or `fontWeight` among siblings.
        - **Layering & Visibility**: Check `zIndex`, `display`, and `visibility`. Debug if elements are being overlapped or are "invisible" due to positioning.
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
    *   Goal: AA (4.5:1) for normal text, 3:1 for large text. Aim for AAA (7:1) for critical UI paths.
- **Token Accuracy**: `caliper_delta_e({ color1, color2 })`. 
    *   Interpret the Oklab Delta E results:
        - `< 0.05`: Imperceptible or "Just Noticeable" (Acceptable token match).
        - `0.05 - 0.1`: Noticeable (Possible wrong token or local override).
        - `0.1 - 0.3`: Distinct (Likely incorrect token usage).
        - `> 0.3`: Very different (Hardcoded or severe design drift).

### 3.3 Physical Measurement

When comparing two separate elements (e.g., "Is the sidebar really 20px from the header?"):
1.  Use `caliper_measure({ primarySelector, secondarySelector })`.
2.  It returns the edge-to-edge distances (`top-to-bottom`, `left-to-right`, etc.).

### 3.4 Design-to-Code Reconciliation

When the user provides a design specification (from text, a task, or an image), follow this "Spec vs. Reality" workflow:

1.  **Extract Spec**: Identify the target values (e.g., `padding: 24px`, `gap: 12px`, `color: #000`).
2.  **Observe Reality**: Perform the full **Audit Loop (Section 3.1)** on the target component. You MUST start with `caliper_inspect` to gather the `sourceHints` required for tracing.
3.  **Identify Drift**: Explicitly calculate the difference (e.g., "The spec requires 24px padding, but the browser is rendering 20px").
4.  **Reconcile**: Edit the source code (traced via `sourceHints`) to match the spec.
5.  **Verify**: Re-measure to confirm the drift is now zero.

## 4. Resource: `caliper://state`

**Subscribe to this resource to passively observe the user.** It provides a real-time stream of the user's browser activity, selection state, and active measurements.

- **Event Trigger**: When the user interacts with the UI (Cmd/Ctrl + Click or hovering over pairs), `caliper://state` updates with fingerprints.
- **Fingerprint Priority**: 
    - **Single Audit**: Use `selectionFingerprint.selector` for single-element tools like `caliper_inspect` or `caliper_walk_dom`.
    - **Pair Audit**: Use `measurementFingerprint.primary` and `measurementFingerprint.secondary` for dual-element tools like `caliper_measure`.
- **Handling Vague Requests**: If the user gives a generic command (e.g., "audit", "check this", "fix this"), your FIRST action must be to read `caliper://state`. 
    - **Selection Found**: Treat the fingerprint as the implicit target and initiate the audit loop immediately.
    - **Continuous Context & Persistence**: If you are in an iterative loop (e.g., a previous fix didn't work, or the user says you're "not getting it"), DO NOT ask for clarification or selectors again. If the user says "fix it", "try again", or "still broken", you must persist with the previous target, re-run a full audit to re-measure, and attempt a different approach immediately.
    - **No Selection/Context**: Do NOT force a Caliper audit. Instead, ask for clarification or use surrounding context to determine the target.
- **Proactive Context**: If you receive a resource update, acknowledge it immediately: *"I see you've selected [Element A] and [Element B] in the browser. Shall I audit the distance between them?"*

## 5. Reporting Format

Always report findings with:
- **Element**: The selector and the traced source file/line.
- **Actual vs Expected**: The measured value vs the design system goal.
- **Recommendation**: The exact CSS/Style fix required.
- **Verification**: A confirmation that you have re-measured after the fix.

> [!TIP]
> **Expert Prompts**: If available, use the pre-built `caliper-selector-audit` or `caliper-selectors-compare` prompts to generate standardized reports for the user.

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
