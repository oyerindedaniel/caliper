# Changelog

All notable changes to this project will be documented in this file.

## [0.1.0] - 2026-02-01

### Added
- Initial release of `@oyerinde/caliper-mcp`.
- **MCP tools**: `caliper_list_tabs`, `caliper_get_context`, `caliper_switch_tab`, `caliper_inspect`, `caliper_measure`, `caliper_clear`, `caliper_walk_dom`, and `caliper_walk_and_measure` (supports semantic rediscovery via JSON fingerprints).
- **Accessibility Tools**: `caliper_check_contrast` for WCAG 2.1 contrast audits and `caliper_delta_e` for perceptual color difference.
- **MCP prompts**: `caliper-selector-audit` and `caliper-selectors-compare`.
- **MCP resources**: `caliper://tabs`.
- CLI support for dynamic port assignment via `--port/-p`.
- Zero-dependency runtime.
