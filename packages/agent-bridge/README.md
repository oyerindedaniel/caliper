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
    wsPort: 9876
  })
);
```

## Configuration 🛠️

| Option | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `enabled` | `boolean` | No | Set to `true` to activate the bridge (default: `false`) |
| `wsPort` | `number` | No | WebSocket port for the MCP relay (default: `9876`) |
| `onStateChange` | `(state: CaliperAgentState) => void` | No | Callback for real-time state synchronization |

## Pro-Tip: Stable Markers 🎯

To help AI agents reliably rediscover elements after code changes or re-renders, use the `caliperProps` helper to mark critical elements:

```tsx
export function caliperProps(marker: string) {
    if (typeof process !== "undefined" && process.env.NODE_ENV === "production") {
        return {};
    }
    return {
        "data-caliper-marker": marker,
    };
}
```

Add these to your key components:
`<div {...caliperProps("submission-button")}>Submit</div>`

## License ⚖️

MIT
