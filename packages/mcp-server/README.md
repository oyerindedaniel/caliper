<img src="https://raw.githubusercontent.com/oyerindedaniel/caliper/main/apps/web/public/caliper_logo.svg" width="144" alt="Caliper Logo" style="margin-bottom: 24px;" />

# @oyerinde/caliper-mcp

Model Context Protocol (MCP) server for Caliper. This server bridges AI agents (like Cursor, Claude Code, or Antigravity) to the Caliper measurement engine running in your browser.

## Features 🚀

- **High Precision**: Agents get the exact sub-pixel geometry from the browser DOM.
- **Visual Feedback**: You can see exactly what the agent is measuring as it happens in the browser overlay.
- **Caliper ID System**: Pinpoint accuracy using stable element identifiers that prevent selector "hallucinations".
- **Multi-Tab Support**: Automatically targets and tracks the focused browser tab.
- **Zero Config**: Standardized WebSocket relay on port 9876.

## Installation & Setup 📦

### 1. In your Web Application
Ensure you have `@oyerinde/caliper-bridge` initialized in your application (see [Bridge README](../agent-bridge/README.md)).

### 2. Configure your Editor (Cursor / Claude Code)

By default, the server runs on port **9876**. If you need to use a different port (e.g., if 9876 is occupied), you can pass the `-p` or `--port` flag.

#### Cursor
Cursor supports MCP via built-in settings. Add the server through the UI or by defining it in your `mcp.json`:

```json
{
  "mcpServers": {
    "caliper": {
      "command": "npx",
      "args": ["-y", "@oyerinde/caliper-mcp", "--port", "9876"]
    }
  }
}
```

1. Open **Cursor Settings** > **Features** > **MCP**.
2. Click **+ Add New MCP Server**.
3. Name: `Caliper`
4. Type: `command`
5. Command: `npx -y @oyerinde/caliper-mcp --port 9876`

#### Claude Code
Add to your Claude configuration:

```bash
claude mcp add @oyerinde/caliper-mcp -- npx -y @oyerinde/caliper-mcp --port 9876
```

### 3. CLI Configuration ⚙️

The following flags are available when running the server:

| Flag | Description | Default |
| :--- | :--- | :--- |
| `-p, --port` | Specify the WebSocket relay port. | `9876` |
| `-h, --help` | Show usage instructions and available options. | - |

> **Note**: Ensure the port used by the MCP server matches the one initialized in the `@oyerinde/caliper-bridge` in your web application.

### 4. Usage
Once connected, the AI agent will have access to high-precision layout tools. You can ask:
- "Inspect the header element for alignment issues."
- "Measure the spacing between the logo and the navigation links."
- "Perform a full accessibility and layout audit."

## Tools Provided 🛠️

- `caliper_list_tabs`: List all browser tabs currently connected to the bridge.
- `caliper_switch_tab(tabId)`: Switch targeting to a specific browser tab.
- `caliper_inspect(selector)`: Deep dive into an element's geometry, z-index, and computed visibility. **Use for general inspection.**
- `caliper_measure(primary, secondary)`: Perform high-precision distance calculation between two elements.
- `caliper_get_state`: Get the current passive state of Caliper (viewport + significant elements with semantic data).
- `caliper_clear`: Reset all active measurements and guides in the UI.
- `caliper_audit_node(selector, designProps, strategy, tolerance?)`: **[REQUIRES FIGMA MCP]** Audit a live element against Figma design properties. `tolerance` defaults to `1` (px). Returns deltas and CSS recommendations.

## Figma MCP Integration 🎨

Caliper works alongside the **official Figma MCP server** (Desktop or Remote) to create a **Closed-Loop Audit System**. The AI agent acts as the translator between Figma's design context and Caliper's live browser measurements.

### Recommended Figma MCP Tools

| Figma MCP Tool | What It Provides | Use For |
| :--- | :--- | :--- |
| `get_metadata` | Sparse XML with layer IDs, names, **position and sizes** | Extracting `nodeX`, `nodeY`, `nodeWidth`, `nodeHeight` |
| `get_variable_defs` | Variables and styles (colors, spacing, typography) | Extracting `paddingLeft`, `paddingRight`, design tokens |
| `get_screenshot` | Visual reference of the selection | Comparing visual output |

### Audit Strategies

| Strategy | When to Use | Design Interpretation |
| :--- | :--- | :--- |
| **A (Container-First)** | Figma frame is the max content width | Element is centered, shrinks on smaller screens |
| **B (Padding-Locked)** | Design relies on fixed edge spacing | Padding is preserved exactly, content stretches |
| **C (Ratio-Based)** | Element must scale proportionally | Width is a percentage of viewport |

### Example Workflow

```
User: "Audit the hero section against Figma"

1. AI calls Figma MCP: get_metadata(selection) 
   -> Returns XML with position/sizes for each layer

2. AI extracts from XML:
   - Frame: width=1440, height=900
   - Hero node: x=70, y=120, width=1300, height=400

3. AI calls Caliper MCP: caliper_audit_node({
     selector: "#hero",
     designProps: {
       frameWidth: 1440,
       nodeX: 70,
       nodeY: 120,
       nodeWidth: 1300,
       nodeHeight: 400,
       paddingLeft: 70,  // from get_variable_defs or calculated
       paddingRight: 70
     },
     strategy: "B"
   })

4. Caliper returns: {
     isPixelPerfect: false,
     recommendations: [{ property: "padding-left", recommendedValue: "70px" }]
   }

5. AI applies the fix and re-audits to confirm.
```

### Adding Custom Rules for Best Results

Add this to your `.cursorrules` or `CLAUDE.md` to help the AI use both MCPs together:

```markdown
## Figma + Caliper Audit Rules
1. Use `get_metadata` to extract layer positions and sizes from Figma.
2. Use `get_variable_defs` to extract spacing/padding tokens.
3. Use `caliper_audit_node` to compare design vs. implementation.
4. Choose the appropriate strategy:
   - A: Container-First (design frame = max-width)
   - B: Padding-Locked (fixed edge spacing)
   - C: Ratio-Based (proportional width)
5. Apply CSS recommendations and re-audit until isPixelPerfect is true.
```

## Prompts Provided 📋

Prompts are pre-defined expert workflows that tell the AI how to use Caliper tools to achieve specific goals. You can trigger them in your editor (e.g., using `/` in Cursor).

| Prompt | Description | When to Use |
| :--- | :--- | :--- |
| `caliper-audit` | Comprehensive UI alignment audit. | When you want a general polish of the current page. |
| `caliper-spacing-check` | Detailed consistency check for repeating components. | To ensure grids and lists have mathematical spacing parity. |
| `caliper-figma-audit` | The "Expert Mode" workflow for Figma-to-Code auditing. | To guide the AI through the 5-step process of design reconciliation. |

## Resources 📚

- `caliper://state`: Read-only access to the current browser layout state.
- `caliper://tabs`: Live list of connected browser windows.

## License ⚖️

MIT
