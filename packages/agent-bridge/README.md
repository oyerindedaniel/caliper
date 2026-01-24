<img src="https://raw.githubusercontent.com/oyerindedaniel/caliper/main/apps/web/public/caliper_logo.svg" width="144" alt="Caliper Logo" style="margin-bottom: 24px;" />

# @oyerinde/caliper-bridge

Agentic bridge for Caliper - enables AI agents to use Caliper's high-precision measurement engine for autonomous UI auditing. 

This package provides the "glue" between your browser-based Caliper UI and the Model Context Protocol (MCP) relay.

## Installation 📦

```bash
pnpm add @oyerinde/caliper-bridge
```

## Usage 🚀

### 1. Initialize with Caliper Core Systems

The bridge requires the `MeasurementSystem` and `SelectionSystem` from `@oyerinde/caliper/core`. In a typical Next.js or Vite application, you would initialize the bridge alongside the main Caliper instance:

```typescript
import { init } from "@oyerinde/caliper";
import { initAgentBridge } from "@oyerinde/caliper-bridge";

const caliper = init();

// Wait for systems to be ready before initializing the bridge
caliper.waitForSystems().then((systems) => {
  initAgentBridge({
    enabled: true,
    systems,
  });
});
```

### 2. Passive State Observation

The bridge automatically maintains an internal cache of the page state. It scans the DOM for "significant" elements and assigns them persistent **Caliper IDs** (e.g., `caliper-8kx2j`).

AI agents use these IDs as stable selectors to performing measurements without the risk of fragile CSS selector path hallucinations.

### 3. Programmatic Control (Manual Dispatch) ⌨️

For manual testing or custom integrations, you can dispatch intents directly from the browser console or your application scripts using `dispatchCaliperIntent`:

```javascript
// Clear all active measurements and guides
await dispatchCaliperIntent({ method: 'CALIPER_CLEAR', params: {} });

// Select an element programmatically
await dispatchCaliperIntent({ 
  method: 'CALIPER_SELECT', 
  params: { selector: '#logo' } 
});
```

## Configuration 🛠️

| Option | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `enabled` | `boolean` | No | Set to `true` to activate the bridge (default: `false`) |
| `systems` | `CaliperCoreSystems` | Yes | Local core systems obtained from `caliper.waitForSystems()` |
| `wsUrl` | `string` | No | Custom WebSocket URL for the MCP relay (default: `ws://localhost:9876`) |
| `debounceMs` | `number` | No | Passive state update interval (default: `200ms`) |
| `minElementSize` | `number` | No | Minimum element size for tracking (default: `24px`) |

## Architecture 🏗️

The bridge acts as a reactive layer that:
1.  **Observes**: Subscribes to layout changes and viewport events.
2.  **Identifies**: Injects non-intrusive `data-caliper-agent-id` attributes into the DOM.
3.  **Relays**: Connects to the `@oyerinde/caliper-mcp` server via WebSockets.
4.  **Executes**: Translates agent "intents" (Inspect, Measure, Select) into high-precision system calls.

## License ⚖️

MIT
