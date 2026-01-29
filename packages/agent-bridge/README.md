<img src="https://raw.githubusercontent.com/oyerindedaniel/caliper/main/apps/web/public/caliper_logo.svg" width="144" alt="Caliper Logo" style="margin-bottom: 24px;" />

# @oyerinde/caliper/bridge

Agentic bridge for Caliper - enables AI agents to use Caliper's high-precision measurement engine for autonomous UI auditing. 

This package provides the "glue" between your browser-based Caliper UI and the Model Context Protocol (MCP) relay.

## Usage 🚀

### 1. Initialize with Caliper
The bridge is initialized as a plugin for the main Caliper instance:

```typescript
import { init } from "@oyerinde/caliper";
import { CaliperBridge } from "@oyerinde/caliper/bridge";

const caliper = init();

caliper.use(
  CaliperBridge({
    enabled: true,
  })
);
```

## Configuration 🛠️

| Option | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `enabled` | `boolean` | No | Set to `true` to activate the bridge (default: `false`) |
| `wsUrl` | `string` | No | Custom WebSocket URL for the MCP relay (default: `ws://localhost:9876`) |
| `debounceMs` | `number` | No | Passive state update interval (default: `200ms`) |
| `minElementSize` | `number` | No | Minimum element size for tracking (default: `24px`) |
| `onStateChange` | `(state: CaliperAgentState) => void` | No | Callback for real-time state synchronization |

## License ⚖️

MIT
