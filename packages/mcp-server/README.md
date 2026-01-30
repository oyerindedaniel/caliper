<img src="https://raw.githubusercontent.com/oyerindedaniel/caliper/main/apps/web/public/caliper_logo.svg" width="144" alt="Caliper Logo" style="margin-bottom: 24px;" />

# @oyerinde/caliper-mcp

Model Context Protocol (MCP) server for Caliper. This server bridges AI agents (like Cursor, Claude Code, or Antigravity) to the Caliper measurement engine running in your browser.

## Features 🚀

- **High Precision**: Agents get the exact sub-pixel geometry from the browser DOM.
- **Visual Feedback**: You can see exactly what the agent is measuring as it happens in the browser overlay.
- **Caliper ID System**: Pinpoint accuracy using stable element identifiers that prevent selector "hallucinations".
- **Multi-Tab Support**: Automatically targets and tracks the focused browser tab.
- **Project Context**: Integrated source code search (grep) to map browser elements directly to your implementation.
- **Zero Config**: Standardized WebSocket relay on port 9876.

## Installation & Setup 📦

### 1. In your Web Application
Ensure you have `@oyerinde/caliper-bridge` initialized in your application (see [Bridge README](../agent-bridge/README.md)).

### 2. Configure your Editor (Cursor / Claude Code / Antigravity)

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

#### Antigravity
Antigravity uses a configuration file named `mcp_config.json`. Add the caliper server to your config:

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

### 3. CLI Configuration ⚙️

The following flags are available when running the server:

| Flag | Description | Default |
| :--- | :--- | :--- |
| `-p, --port` | Specify the WebSocket relay port. | `9876` |
| `-d, --docs` | Show a link to the official documentation. | - |
| `-h, --help` | Show usage instructions and available options. | - |

> **Note**: Ensure the port used by the MCP server matches the one initialized in the `@oyerinde/caliper-bridge` in your web application.

### 4. Usage
Once connected, the AI agent will have access to high-precision layout tools. You can ask:
- "Inspect the header element for alignment issues."
- "Measure the spacing between the logo and the navigation links."
- "Check the contrast ratio between the text and background colors."

## Tools Provided 🛠️

- `caliper_list_tabs`: List all browser tabs currently connected to the bridge.
- `caliper_switch_tab(tabId)`: Switch targeting to a specific browser tab.
- `caliper_inspect(selector)`: Get an element's geometry, z-index, and full computed styles (padding/margin).
- `caliper_measure(primary, secondary)`: Perform high-precision distance calculation between two elements.
- `caliper_clear`: Reset all active measurements and guides in the UI.
- `caliper_grep(query, tag?)`: Search the codebase for elements using text, IDs, or tags.
- `caliper_walk_dom(selector)`: Inspect the DOM hierarchy (parents/children) of a specific element.
- `caliper_parse_selector(jsonString)`: Parse rich selector data copied from the Caliper UI.
- `caliper_walk_and_measure(selector, maxDepth?)`: Comprehensive recursive DOM walk with style and gap extraction.
- `caliper_check_contrast(foreground, background)`: Check WCAG 2.1 contrast ratio between two colors (hex, rgb, oklch, etc.).
- `caliper_delta_e(color1, color2)`: Calculate perceptual color difference between two colors using Oklab.


## Prompts Provided 📋

Prompts are predefined expert workflows. Trigger them in your editor (e.g., using `/` in Cursor).

| Prompt | Description |
| :--- | :--- |
| `caliper-selector-audit` | Comprehensive, structured element audit (source discovery + precision analysis). |
| `caliper-selectors-compare` | Compare two elements (A reference vs B target) to fix styling. |

## Resources 📚

- `caliper://tabs`: Live list of connected browser windows.

## License ⚖️

MIT
