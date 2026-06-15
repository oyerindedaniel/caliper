# Handoff note arrow navigation contract

Collapsed caret only. Doc/wire line = segment between `\n` characters (not visual wrap).

## Shift+Enter (soft line break)

Editor-owned (`beforeInput` → `applyDocLineBreak`); browser default is prevented.

Follows the **default soft line-break contract** used by typical text fields and chat editors (Slack, Discord, Notion, etc.):

- Insert `\n` at the caret (or before an atomic `@` pill when the caret is on the pill start).
- **Caret lands on the new blank at or after the break** — on the inserted line, ready to type.
- **Caret never regresses** to an earlier wire offset on the same break (no backward jump to the previous visual row’s content end).
- Consecutive Shift+Enter presses advance monotonically through blank lines (no freeze).
- **Wire newline line box:** wire `\n` renders as `<br data-handoff-wire-break>`; when the document ends with `\n`, an extra `<br data-handoff-line-pad>` (layout-only, not wire) creates a paintable blank line and caret target after the first break.

Mention-boundary breaks (caret on pill start) use the same caret rule: newline before the pill, caret on that new blank — same as whitespace-only inter-pill gaps.

## Up / Down — vertical only

- Move one **wire line** up or down when an adjacent wire line exists; never step along the same line.
- **Row start (column 0):** Up/Down lands on **column 0** of the adjacent wire line above or below. Empty lines use the same rule — not the previous line’s end.
- **Any other column:** preserve **absolute column** on the target wire line; **clamp to target row end** if that line is shorter.
- **Visual line start:** when caret X aligns with the left edge of the current visual row, land on the **target visual row start** — DOM probe at that column when the editor root is available, accepting the hit only when the resolved wire is on the target visual row **and** its measured X aligns with the goal column; otherwise closest sample X on the target row. **Mention start row landing** (target-row min-wire) applies on Up and when Down aligns with visual row start; mid-column Down from mention start uses row bracketing instead. **Vertical goal column** sticks across consecutive Up/Down until a horizontal arrow or doc mutation. Mid-text soft wrap needs the probe because boundary samples omit the content column; multi-line text nodes can yield probe hits on the wrong band or column.
- **Mention atomicity:** never land inside a pill. Project column first; if inside a pill → **Down:** pill end; **Up:** pill start. If past the pill → tail at that column. No scan for mid-line `@` on wire rows.
- **Down from content:** enter the first line below (including empty lines); do not jump to a later mention on the current line.
- **Boundary bleed (Clash-style):** when there is no line above/below (and, in the overlay, no visual row remains), vertical key **falls through to horizontal** on the current line — not a no-op.
  - **First line + Up** → same as **Left** (one horizontal step back).
  - **Last line + Down** → same as **Right** (one horizontal step forward).
  - **Multiline `\n` docs:** bleed only on the first/last **wire line** and only when soft-wrap layout does not still owe a vertical move. If layout is exhausted at the true visual top/bottom, bleed still applies.
- **Mid-document:** Up/Down never substitute horizontal motion; only at vertical extremes.
- **Editor resolution order:** (1) wire cross-line when an adjacent `\n` line exists; (2) DOM visual row when layout has another row above/below; (3) boundary bleed only at true visual top/bottom. Wire bleed must not short-circuit DOM on single-line soft wrap.
- **Unsampled wire offsets:** sparse layout samples bracket each wire offset to a visual row (interpolate Y between bracketing samples, or measure text-node coords when the editor root is available). Column match on a target visual row interpolates X between bracketing samples on that row so interior prefix/suffix positions are preserved on Up/Down. **Mention-adjacent rows:** mention end and the text node immediately after it share one visual band top before row clustering so they cannot land on different visual rows. **Row clustering:** visual row centers merge pill midYs with measured sample tops so soft-wrapped continuation text on the same wire line still yields distinct visual rows when measured Y diverges from pill bands. Mid-wrap vertical moves use that row/column assignment; horizontal bleed must not substitute when another visual row exists.

## Left / Right — horizontal only

- Move one logical step along the wire on the **current line** (same primitive as vertical boundary bleed).
- **Pill atomic:** step over a pill as one token; never land inside pill interior text.
- **Adjacent mentions on one line:** step mention-to-mention here, not with Up/Down (except boundary bleed above).
- **At doc start + Left** or **doc end + Right:** no-op when unhandled (stay at start/end).

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
