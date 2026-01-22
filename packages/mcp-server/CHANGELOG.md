# Changelog

All notable changes to this project will be documented in this file.

## [0.1.0] - 2026-01-22

### Added
- Initial release of `@oyerinde/caliper-mcp`.
- **`caliper_audit_node` tool**: Compare live browser elements against Figma design properties using three strategies (Container-First, Padding-Locked, Ratio-Based).
- MCP-compliant tools: `caliper_list_tabs`, `caliper_inspect`, `caliper_measure`, `caliper_get_state`, and `caliper_clear`.
- MCP-compliant resources: `caliper://state` and `caliper://tabs`.
- CLI support for dynamic port assignment via `--port/-p`.
- Zero-dependency runtime (no dependency on the main UI library).
- Figma MCP Integration Guide for closed-loop design auditing.

