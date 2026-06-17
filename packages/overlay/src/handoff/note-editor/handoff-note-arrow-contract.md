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

- **One keypress = one visual row** (what the user sees), whether the row comes from soft wrap, a wire `\n` line, or a Shift+Enter break.
- **Vertical goal column** (measured X) sticks across consecutive Up/Down on **content rows** until a horizontal arrow or doc mutation. Crossing into or through an **embedded blank band** follows the blank rules below (goal resets to visual row start).
- **Content rows — preserve column:** when the target row has substantive content, land at the sticky goal column (DOM probe, closest sample X, or bracketing); **clamp** if the row is shorter. **Shorter target row:** if sticky goal X is past the target row’s content extent, land at that row’s **content end** (last valid caret on the row — text tail or pill end per mention atomicity). Do not land in trailing empty layout past content; sticky goal column is unchanged for the next move. Mid-text soft wrap needs the probe because boundary samples omit interior columns.
- **Content rows — row start:** when sticky goal is at the visual row’s left edge, land at that same edge on the target content row — not the previous row’s end, not max-wire tail, not wire-column preservation across rows.
- **Wire `\n` segments** are storage only — they do not choose the step. They matter for **landing** (which doc offset matches the target visual row + goal column).
- **Mention atomicity:** never land inside a pill. Project column first; if inside a pill → **Down:** pill end; **Up:** pill start. If past the pill → tail at that column. No scan for mid-line `@` on wire rows.
- **up/down from content:** enter the first visual row below (including empty rows); do not jump to a later mention on the current row.
- **Boundary bleed (Clash-style):** when **no visual row** remains above/below, vertical key **falls through to horizontal** on the current row — not a no-op.
  - **First visual row + Up** → same as **Left** (one horizontal step back).
  - **Last visual row + Down** → same as **Right** (one horizontal step forward).
  - **Multiline `\n` docs:** bleed only at the true visual top/bottom once layout is exhausted.
- **Mid-document:** Up/Down never substitute horizontal motion; only at visual extremes.
- **Editor resolution order (overlay):** (1) **visual row** when layout has another row above/below — land per column rules (content preserve vs blank row start); (2) **boundary bleed** only at true visual top/bottom once layout is exhausted; (3) otherwise **no-op** (`handled: false`). Overlay does not wire-cross; core `resolveDocVerticalArrowMove` is doc-policy only.
- **Unsampled wire offsets:** sparse layout samples bracket each wire offset to a visual row (interpolate Y between bracketing samples, or measure text-node coords when the editor root is available). Column match on a target visual row interpolates X between bracketing samples on that row so interior prefix/suffix positions are preserved on Up/Down.
- **Embedded blank bands (Shift+Enter empty rows):** stacked empty **visual** rows between substantive content — from Shift+Enter in a text node (with or without a preceding mention). **Visual row is the authority for Up/Down:** one keypress moves to the adjacent painted row above or below. Wire may contain multiple `\n` characters; they are **storage only** — navigation does **not** allocate one arrow row per `\n` by default.
  - **Line break vs blank line:** `\n` means “move to a new line,” not “insert a blank line.” What the user sees depends on what comes before and after the break. If substantive text follows, it is a normal line break (`a\nb` → two lines: `a`, then `b`). A blank line appears only when an **empty segment** sits between line breaks — nothing between two `\n` (`a\n\nb` → three lines: `a`, blank, `b`). The blank is the empty segment, not the `\n` character itself.
  - **What counts as one blank visual row:** an empty line the user sees between substantive lines (e.g. `header` → empty line → `tail` is **three** visual rows). Consecutive Shift+Enter presses that add empty lines each advance the caret through those rows monotonically (Shift+Enter section above).
  - **What is not an extra blank row:** a `\n` that only **starts** the next substantive line on the row below (e.g. the second `\n` in `header\n\ntail` before `tail`) is line-start storage for the tail row — **not** a second empty row to step through. Do not treat “line break before next content” as a blank-band stop.
  - **Blank-band column (standard empty-line behavior):** an empty visual row has no interior column — landing is always at that row’s **visual line start** (break wire from layout / `<br data-handoff-wire-break>` geometry). **Entering a blank row resets sticky goal column to that visual start.** Blank → blank stays at visual start. Blank → content lands at the target content row’s **visual start** (row-start rule) — do not carry a prior content row’s end column through the band.
  - **Examples:** `header\n\ntail` — three visual rows (header, blank, tail). From end of `tail` at visual start: **Up** → blank at visual start; **Up** → header at visual start. From end of `tail` at a later column (e.g. pill end): **Up** → nearest blank at visual start (sticky resets); further **Up** through blanks at visual start; **Up** to header at visual start — not at the pre-band pill-end column. Not four rows; not a stop on the `\n` before `tail` unless that row is visually empty.
  - **Layout:** content rows and blank rows are ordered by measured **`top`** (visual Y). Mention end and immediately following text on the same paint band share one visual row before clustering. **Down from content:** skip inline blanks that share the current row’s measured top (first break on the same paint band). **Up** steps through each **visual** row above, not each wire `\n`. Row clustering merges pill midYs with measured sample tops for soft wrap. Horizontal bleed must not substitute when another visual row exists.
  - **Core helper:** `listEmbeddedBlankBandProbeWires` identifies break wires for **empty** visual rows only — not substantive wire-line breaks like `line1\nline2`, and not a content line-start `\n` before the next substantive segment.

## Left / Right — horizontal only

- Move one logical step along the wire on the **current line** (same primitive as vertical boundary bleed).
- **Pill atomic:** step over a pill as one token; never land inside pill interior text.
- **Adjacent mentions on one line:** step mention-to-mention here, not with Up/Down (except boundary bleed above).
- **At doc start + Left** or **doc end + Right:** no-op when unhandled (stay at start/end).

## Shared

- **Authority:** editor doc position wins; repair/sync before acting on keydown.
- **Mentions:** vertical crosses rows; horizontal crosses tokens on a row.
- **Tests:** integration and unit tests assert **contract behavior**, not implementation branches. A failing test means the code or the oracle is wrong — **never weaken the contract** to green a patch. Wrong tests get fixed or removed; symptom-specific landing rules are not added to satisfy a test.
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
