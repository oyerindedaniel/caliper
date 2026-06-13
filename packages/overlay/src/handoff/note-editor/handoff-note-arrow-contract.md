# Handoff note arrow navigation contract

Collapsed caret only. Doc/wire line = segment between `\n` characters (not visual wrap).

## Up / Down — vertical only

- Move one **wire line** up or down; never step along the same line.
- Preserve **absolute column** on the target row; clamp to row end if shorter.
- **Visual line start:** when caret X aligns with the left edge of the current visual row, land on the **target visual row start** — DOM probe at that column when the editor root is available, accepting the hit only when the resolved wire is on the target visual row **and** its measured X aligns with the goal column; otherwise closest sample X on the target row. Mid-text soft wrap needs the probe because boundary samples omit the content column; multi-line text nodes can yield probe hits on the wrong band or column.
- **Mention atomicity:** never land inside a pill. Project column first; if inside a pill → **Down:** pill end; **Up:** pill start. If past the pill → tail at that column. No scan for mid-line `@` on wire rows.
- **Empty line:** land at the same column on that line (column `0` → line start).
- **Up from blank at column 0:** land at **column 0** of the line above, not that line’s end.
- **Down from content:** enter the first line below (including empty lines); do not jump to a later mention on the current line.
- **Boundary bleed (Clash-style):** when there is no line above/below, vertical key **falls through to horizontal** on the current line — not a no-op.
  - **First line + Up** → same as **Left** (one horizontal step back).
  - **Last line + Down** → same as **Right** (one horizontal step forward).
- **Mid-document:** Up/Down never substitute horizontal motion; only at vertical extremes.
- **Editor resolution order:** (1) wire cross-line when an adjacent `\n` line exists; (2) DOM visual row when layout has another row above/below; (3) boundary bleed only at true visual top/bottom. Wire bleed must not short-circuit DOM on single-line soft wrap.

## Left / Right — horizontal only

- Move one logical step along the wire (same primitive as vertical boundary bleed).
- **Core-owned:** editor applies all handled horizontal moves; plain text and mentions use `resolveHorizontalBleedWireMove`.
- **Atomic mentions:** jump over mention tokens; interior snaps to nearest boundary.
- **Adjacent mentions on one line:** step mention-to-mention here, not with Up/Down (except boundary bleed above).
- **At doc start + Left** or **doc end + Right:** no-op when unhandled.

## Shared

- **Authority:** editor doc position wins; repair/sync before acting on keydown.
- **Mentions:** vertical crosses lines; horizontal crosses tokens on a line.
- **Logging (debug):** direction, `fromWire`, `toWire`, `branch`, `lineIndex` delta.

## Not in scope

- Shift+arrow selection ranges
- Browser default when handler returns `false`
- Mention popover keyboard (separate controller)

## Pill click selection (editor)

- **Click pill:** select that **doc node instance** only (`selectedMentionNodeIndex`); native caret cleared; tray may still set `highlightedAgentId` by agent id.
- **Highlight in note:** by **node index**, not agent id — duplicate `@` pills do not all light up.
- **First arrow after select:** vertical → **row start** of that pill’s wire line; horizontal → **pill end**; then normal caret navigation.
- **Clear selection:** text mousedown, typing, doc mutation, `@` popover open, or arrow exit.
- **Popover open:** list arrows stay on popover; editor pill exit is suppressed and pill selection is cleared on popover input.
