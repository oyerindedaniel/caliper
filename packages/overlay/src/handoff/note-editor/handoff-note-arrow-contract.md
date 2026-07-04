# Handoff note arrow navigation contract

Collapsed caret only. Doc/wire line = segment between `\n` characters (not visual wrap).

## Shift+Enter (soft line break)

Editor-owned (`beforeInput` → `applyDocLineBreak`); browser default is prevented.

Follows the **default soft line-break contract** used by typical text fields and chat editors (Slack, Discord, Notion, etc.):

- Insert `\n` at the caret (or before an atomic `@` pill when the caret is on the pill start).
- **Caret lands on the new blank at or after the break** — on the inserted line, ready to type.
- **Caret never regresses** to an earlier wire offset on the same break (no backward jump to the previous visual row’s content end).
- Consecutive Shift+Enter presses advance monotonically through blank lines (no freeze).
- **EOF trailing blank band:** when a break extends a blank run at doc end with no substantive row below, caret lands on the **new blank’s probe wire** (last probe in that band), not past `wire.length`. The next insert fills that visual row; backspace on that blank uses blank-band collapse.
- **Wire newline line box:** wire `\n` renders as `<br data-handoff-wire-break>`; when the document ends with `\n`, an extra `<br data-handoff-line-pad>` (layout-only, not wire) creates a paintable blank line and caret target after the first break.

Mention-boundary breaks (caret on pill start) use the same caret rule: newline before the pill, caret on that new blank — same as whitespace-only inter-pill gaps.

## Up / Down — vertical only

- **One keypress = one visual row** (what the user sees), whether the row comes from soft wrap, a wire `\n` line, or a Shift+Enter break.
- **Vertical goal column** (measured X) sticks across consecutive Up/Down on **content rows** until a horizontal arrow or doc mutation. Crossing into or through an **embedded blank band** follows the blank rules below (goal resets to visual row start).
- **Content rows — preserve column:** when the target row has substantive content, land at the sticky goal column by resolving the visual point on the target row first (DOM pill half-split when sticky X is inside a painted pill bbox; else DOM point probe when an editor root is available; sparse samples only as fallback); **clamp** if the row is shorter. **Shorter target row — content end:** if sticky goal X is past the target row’s content extent, land at that row’s **content end** (last valid caret on the row — text tail or pill end per mention atomicity). Do not land in trailing empty layout past content. **Sticky after clamp (layout authority):** preserve the pre-clamp goal when the target is a **post-mention soft-wrap continuation row**, or when moving **Up** into a shorter row separated from the source row by **same-wire soft wrap only** (no embedded `\n` between row wire ranges — classic column stickiness). Mid-text soft wrap needs the probe because boundary samples omit interior columns.
- **Content rows — row start:** when sticky goal is at the visual row’s left edge, land at that same edge on the target content row — not the previous row’s end, not max-wire tail, not wire-column preservation across rows.
- **Wire `\n` segments** are storage only — they do not choose the step. They matter for **landing** (which doc offset matches the target visual row + goal column).
- **Mention atomicity:** never land inside a pill. When sticky goal X is strictly inside a pill’s painted horizontal span (DOM bbox on probe, layout sample span on sparse fallback), land at **pill start** when X is in the left half of that span and **pill end** when X is in the right half — same rule for Up and Down. If past the pill → text at that column. No scan for mid-line `@` on wire rows.
- **up/down from content:** enter the first visual row below (including empty rows); do not jump to a later mention on the current row.
- **Boundary bleed (Clash-style):** when **no visual row** remains above/below, vertical key **falls through to horizontal** on the current row — not a no-op.
  - **First visual row + Up** → same as **Left** (one horizontal step back).
  - **Last visual row + Down** → same as **Right** (one horizontal step forward).
  - **Multiline `\n` docs:** bleed only at the true visual top/bottom once layout is exhausted.
- **Mid-document:** Up/Down never substitute horizontal motion; only at visual extremes.
- **Editor resolution order (overlay):** (1) **visual row** when layout has another row above/below — land per column rules (content preserve vs blank row start), using the source caret's DOM rect for the goal X when available; (2) **boundary bleed** only at true visual top/bottom once layout is exhausted; (3) otherwise **no-op** (`handled: false`). Overlay does not wire-cross; core `resolveDocVerticalArrowMove` is doc-policy only. **`resolveDomVerticalArrowMove`** is the production path (DOM geometry first). Measured-only test helpers may exercise sparse **row-edge** fallback (row start/end, past-end); interior column preservation without a DOM probe is not the UX contract.
- **Unsampled wire offsets:** sparse layout samples bracket each wire offset to a visual row (interpolate Y between bracketing samples, or measure text-node coords when the editor root is available). **Column on content rows:** DOM pill half-split when sticky X is inside a painted pill bbox; else DOM point probe on the target row at the layout map’s target-row Y and sticky goal X. After a probe miss, sparse fallback is **edge-only** — row visual start, row content end (including source-at-row-end → target row end), and past-end snap to the nearest layout sample on the target row. **No interior column interpolation** between sparse samples; mid-row column preservation requires a successful DOM probe. Mention half-split still applies on sparse edge landings when goal X is inside a pill sample span. **Same-wire soft-wrap band:** adjacent content rows with no `\n` in `[upperRowMaxWire, lowerRowMinWire)` — the upper row max sample may sit on the wire `\n`; that counts as a wire-line break, not soft wrap. **Past-end** snap: when the source is at doc past-end or sparse row-end landing targets an unsampled wire, snap to the nearest layout sample on the target row. Mention atomicity applies on edge landings (goal inside pill span → boundary, not interior).
- **Post-mention soft-wrap tail:** when substantive text after a mention wraps entirely to the next visual row (row-0 spacer prefix only, lower-row tail anchor sample), layout promotes continuation samples and assigns unsampled interior wires to the wrap row — not the pill band via mention-adjacent align. **Column:** wrap-tail coords bracket within the continuation fragment (wrap-row `left`), not row-0 tail samples at mention-band X.
- **Wire-newline row visual start (layout):** when substantive text begins after an embedded `\n` (normal line break, not a blank band), layout may promote a sample at that segment’s **first substantive wire** so blank-band exit and row assignment see the painted line start. That sample’s **`left` is the visual start of the line** — wire-break geometry or measured text coords — **never** the past-end / EOF column of a longer row. Past-end samples keep wide sticky column; line-start samples keep row-start geometry. Do not copy max-row `left` onto the first character.
- **Embedded blank bands (Shift+Enter empty rows):** stacked empty **visual** rows between substantive content — from Shift+Enter in a text node (with or without a preceding mention). **Visual row is the authority for Up/Down:** one keypress moves to the adjacent painted row above or below. Wire may contain multiple `\n` characters; they are **storage only** — navigation does **not** allocate one arrow row per `\n` by default.
  - **Line break vs blank line:** `\n` means “move to a new line,” not “insert a blank line.” What the user sees depends on what comes before and after the break. If substantive text follows, it is a normal line break (`a\nb` → two lines: `a`, then `b`). A blank line appears only when an **empty segment** sits between line breaks — nothing between two `\n` (`a\n\nb` → three lines: `a`, blank, `b`). The blank is the empty segment, not the `\n` character itself.
  - **What counts as one blank visual row:** an empty line the user sees between substantive lines (e.g. `header` → empty line → `tail` is **three** visual rows). Consecutive Shift+Enter presses that add empty lines each advance the caret through those rows monotonically (Shift+Enter section above).
  - **What is not an extra blank row:** a `\n` that only **starts** the next substantive line on the row below (e.g. the second `\n` in `header\n\ntail` before `tail`) is line-start storage for the tail row — **not** a second empty row to step through. Do not treat “line break before next content” as a blank-band stop.
  - **Blank-band column (standard empty-line behavior):** an empty visual row has no interior column — landing is always at that row’s **visual line start** (break wire from layout / `<br data-handoff-wire-break>` geometry). **Entering a blank row resets sticky goal column to that visual start.** Blank → blank stays at visual start. Blank → content lands at the target content row’s **visual start** (row-start rule) — do not carry a prior content row’s end column through the band.
  - **Examples:** `header\n\ntail` — three visual rows (header, blank, tail). From end of `tail` at visual start: **Up** → blank at visual start; **Up** → header at visual start. From end of `tail` at a later column (e.g. pill end): **Up** → nearest blank at visual start (sticky resets); further **Up** through blanks at visual start; **Up** to header at visual start — not at the pre-band pill-end column. Not four rows; not a stop on the `\n` before `tail` unless that row is visually empty.
  - **Layout:** content rows and blank rows are ordered by measured **`top`** (visual Y). Mention end and immediately following text on the same paint band share one visual row before clustering. **Down from content:** skip inline blanks that share the current row’s measured top (first break on the same paint band). **Up** steps through each **visual** row above, not each wire `\n`. Row clustering merges pill midYs with measured sample tops for soft wrap. Horizontal bleed must not substitute when another visual row exists.
  - **Core helper:** `listEmbeddedBlankBandProbeWires` identifies break wires for **empty** visual rows only — not substantive wire-line breaks like `line1\nline2`, and not a content line-start `\n` before the next substantive segment.

### Wire `\n` classification for layout (extends §36–38)

On the wire, `\n` always means **start next line**. Layout and navigation classify the **segment after** that break:

- **Empty segment after `\n`** (nothing or whitespace only until the next break) → **blank visual row**. Each empty line the user sees is one Up/Down step. Layout must **not collapse** consecutive empty rows into one row.
- **Substantive text after `\n`** → **content visual row** (normal line break). Example: `line1\nline2` — row for `line1`, then row for `line2`. Layout must assign a **distinct measured top** per substantive wire line inside embedded text nodes, not fold the whole node into one visual row.

Stacked Shift+Enter blanks (`\n\n` with empty segments) remain **separate blank visual rows** — Up/Down round-trip parity through each blank row.

## Click ingress (text mousedown / selectionchange)

Editor-owned reconciliation on `selectionchange` after user click. Builds on pill-click (§ Pill click selection); does **not** change Backspace/Delete at blank-band probes policy.

- **Rule 1 — click wins:** If a click resolves to a valid DOM text position on the editor, **accept it** as authority.
- **Rule 2 — repair scope:** Repair on `selectionchange` runs only when the click lands in an **invalid or unrepresentable** region (e.g. pill interior strand, selection outside root) — not when live wire reads as a blank probe but the DOM still resolved meaningful text on the intended row.
- **Rule 3 — no regress:** Repair must **never move the caret farther from the user’s click target** when a valid position already exists.
- **Rule 4 — text-node tail ownership:** The trailing edge of a substantive content text node (browser `offset === text.length` on that node) maps to **content row end** — the last character on that row — not the following wire `\n` or blank-band probe. Blank-band probe wires apply only when the browser places the selection in blank-band infrastructure (blank anchor, wire-break caret target, or explicit probe resolution from `resolveDomPointAtDocPos` at a probe wire).

Industry norm (VS Code, Google Docs, Notion, Slack, CodeMirror): **click location wins** unless the DOM cannot represent the requested position. “Content row end above band” is **Backspace/Delete policy** (structural cleared-row-end), not click repair.

## Backspace / Delete at blank-band probes

Editor-owned (`beforeInput` → `applyDocDelete` → `resolveHandoffNoteDeleteIntent`); same probe wires as arrow landing (`listEmbeddedBlankBandProbeWires`).

### Delete authority (principles)

- **Single authority:** `resolveHandoffNoteDeleteIntent` decides meaning from **doc position + direction** before any splice. No cross-key flags (`chipBeforeBlankBand`, `pendingBlankBandDelete`, etc.) — prior edits affect **caret landing only**, not what the next key “means.”
- **Collapsed caret — one unit per key:** **Backspace** removes **one unit left** (one character, one blank visual row, or one whole mention atom). **Delete** removes **one unit right** under the same rules. **Selection** deletes the highlight; both keys behave the same on a range.
- **Mentions are units:** a committed pill is one atom for delete intent. Backspace at mention **start** with a mention immediately left removes the **left** pill (including glued `@A@B`). Delete at mention **start** removes the **right** pill. Interior/backspace-end paths still use `resolveHandoffNoteMentionEdit` / `snapDeleteCaretWire` where documented below.
- **Paint vs intent:** the same wire offset can alias probe infrastructure and content-row end after a chip. **Intent** uses structural helpers with **focus doc position** when required (`embeddedBlankBandAtEmptyContentRowEnd`, `handoffNoteCaretAtClearedContentRowEndBeforeProbe`, `isEmbeddedBlankBandDeleteProbeWire`). **DOM paint** (`resolveDomPointAtDocPos`) passes the same focus into `embeddedBlankBandAtEmptyContentRowEnd` so cleared row end paints `<br data-handoff-wire-break>` while delete-probe infrastructure paints blank-band anchor text.

### Probe classification (structural, not flags)

- **Delete-probe infrastructure** (`isEmbeddedBlankBandDeleteProbeWire`): caret on blank-band infrastructure — collapse removes one blank-row `\n` per keystroke in band rules below. Wire-only checks suffice for navigation onto a probe; **with focus**, interior band tail probes and EOF trailing-band tail probes stay delete infrastructure even when `focusWire === lineStart`.
- **Empty content row end** (`embeddedBlankBandAtEmptyContentRowEnd`): caret on the **cleared** substantive row gate before a probe (row above probe is empty **and** focus matches semantic row end / line-start gate via `handoffNoteCaretAtClearedContentRowEndBeforeProbe`). **Not** interior band tail (last probe in a multi-probe band with substantive tail below) and **not** EOF trailing-band tail (last probe with no substantive row below the band). After chip, the next backspace/delete on that gate collapses blank per empty-row-end paths — not “armed” by a consumed flag.
- **Cleared-row misfire guards:** `isBlankBandInteriorTailProbe` and `isBlankBandEofTailProbe` prevent `focusWire === lineStart` from classifying band-interior or EOF-tail probes as cleared content row end.

### Content row chip and landing

- **Content row chip:** backspace or delete on trailing row text immediately before a probe removes characters normally (including the last character on the row). Deleting the last character does **not** promote the caret into blank-band delete-probe paint; landing uses `docPosAfterContentRowChipBeforeProbe` / `embeddedBlankBandContentRowEndBeforeProbe` so the caret rests on **cleared content row end** or mention alias, not zwsp infrastructure.
- When a partial chip leaves substantive text on a **sole-char sandwiched** row, caret **doc position** lands on **char wire** (visual start), not probe-wire paint — wire index alone is ambiguous (`docPosAfterContentRowChipBeforeProbe`).
- When substantive content abuts a probe (`embeddedBlankBandSubstantiveContentAbutsProbe`), chip and collapse landing use **`docPosAtEmbeddedBlankBandProbeAliasLanding`** / **`docPosAfterContentRowChipBeforeProbe`** — authority on **mention-node end** or cleared content-row end, not blank-band zwsp infrastructure. This covers **spacer chips** and **glued postfix** substantive chips (mention abuts probe with no spacer).
- **Collapse selection landing** (`blankBandSelectionFocus`): after blank-band **collapse** moves, caret rests on the **probe wire** when `probeInfrastructureLanding` is true (default). When false (mention-end alias at probe, including delete forward through `resolveDeleteForwardFromMentionAbuttingProbe` empty-row-end fallback), landing stays on mention-end / content-row alias — not raw probe infrastructure.
- **Delete intent order:** mention interior abutting probe (backspace/remove paths), mention **node** end backspace → atomic mention remove; mention **node** end at probe alias + Delete → blank collapse look-right via forward path (embedded blank-band delete or empty-row-end fallback); spacer-before-probe → row chip; text-node caret on probe wire without spacer → blank collapse per band rules below.

### Branch taxonomy (implementation labels)

Logged on delete moves; drives `blankBandSelectionFocus` landing buckets:

- **`row-chip-before-probe`** — remove trailing row text immediately before a blank-band probe (`caretAtContentRowEndBeforeProbe` authority).
- **`step-to-content-row-end`** — prefix-only band head: first backspace on delete-probe steps to content row end above; wire unchanged.
- **`backspace-collapse-blank`** — backspace on blank-band delete infrastructure removes one blank-row `\n`.
- **`delete-collapse-blank-mid-band`** / **`delete-collapse-blank-at-edge`** — delete on blank-band infrastructure; mid-band lands on next probe below, band edge lands on lower substantive **visual start**.
- **`backspace-line-start-collapse`** — `\n` before lower substantive content when every segment above is empty (leading blanks consumed).
- **`backspace-line-break-join`** / **`delete-line-break-join`** — single substantive `\n` between two populated rows (not a blank-band probe): merge rows; caret at join point.

### Row-chip authority (doc position)

Row chip runs only when `caretAtContentRowEndBeforeProbe` (or sole-char probe alias / spacer-before-probe) — not on interior nibbles. **≤2-char same text-node rows:** interior backspace nibble (char behind caret). **3+ chars** at segment tail, or **mention-row postfix** in a separate text node: row chip. Caret on multi-char blank-band probe infrastructure without alias: collapse, not chip.

### Directional nibbling (Backspace vs Delete)

- **In-row text (standard editor):** backspace removes the unit **behind** the caret; delete removes the unit **ahead**. The caret **stays at the deletion point** — no post-edit jump. Example (caret landing only): visual row 0 `he`, rows 1–2 blank; caret after `h` on row 0 → backspace removes `h`, row 0 is `e`, caret stays **before** `e` — not after `e`. At **visual start** of a populated row, backspace does **not** nip that row’s text (nothing behind the caret on that row); use **delete** forward or move the caret to **content row end** to remove text ahead on the same row. Follow-up (blank above, same row still `e`): visual row 0 blank, row 1 `e`, caret before `e` on row 1 → backspace nips the **blank on row 0**, not `e`. At **content row end** of a populated row, delete does **not** nip further on that row without moving.
- **Progressive trashing landings (blanks and band edges only):** when the next key must keep trashing through **blank infrastructure** or reach populated text on the **adjacent** row, land so the following keystroke works in that direction — backspace → **content row end** on the populated row above; delete → **visual start** on the populated row below. Applies to sandwiched blanks, blank-band collapse exhaustion, backspace on a blank with populated row above (step to content row end above), and the delete mirror — **not** after an ordinary in-text backspace/delete on a populated row.
- On **blank** rows, each key nips **blank infrastructure** (one blank visual row per keystroke) in its direction — not populated text.
- **Inter-mention gap:** backspace/delete in the whitespace **gap node** between two pills chips or merges per direction; after a merge that glues adjacent mentions, caret lands via `caretAfterInterMentionGapMerge` so the **next** key’s left/right unit matches user intent (row-prefix end when substantive text precedes the left pill, else right-pill start).
- **Blank-band collapse (Backspace):** each backspace on blank-band delete infrastructure removes one blank-row `\n`. **Within a band** (substantive row above exists, or mid-band), land on the **remaining blank probe above** and repeat until sandwiched or prefix rules apply. When **no substantive row sits above** the removed blank (leading / prefix-only blanks), backspace **nips blank rows themselves** — one per keystroke, caret drops to the **visual start of the next row below** after each removal eating blank infrastructure, not text. If that next row is **still blank**, the next backspace nips again; if it is the **visual start of populated content**, nipping **stops** (nothing behind the caret on that row). If the doc above was **all blanks**, nipping continues until only **row 0** remains. When the probe was **sandwiched** (substantive above **and** substantive below the band group), collapse the blank `\n` then land on **content row end above** so repeated backspace nips that populated row from the back. When substantive content sits above but **not** below the band (prefix-only trailing blanks at the band head), the first backspace **steps** to content row end above (wire unchanged); further backspace chips that row from the back, then blank collapse as above once the row is empty.
- **Line-start collapse (Backspace):** a `\n` immediately before lower substantive content (line-start storage, not a blank-band probe) collapses on backspace when every segment above it in the wire is empty — one blank-row nip; land at the first substantive row **visual start** (stop nipping if populated; continue blank nipping only while rows below remain blank).
- **Substantive line-break join:** a single `\n` with **populated rows on both sides** (normal `line1\nline2` storage — not a blank-band probe) merges on **backspace at the lower row visual start** or **delete on the break wire**; caret lands at the join point (end of upper row text). Distinct from blank-band collapse and from in-row nibble on the upper row.
- **Blank-band collapse (Delete):** mirror **downward** — each delete on blank-band delete infrastructure removes one blank-row `\n`. **Within a band**, land on the **next blank probe below** and repeat. When **no substantive row sits below** (trailing blanks only), delete **nips blank rows themselves** downward — one per keystroke — until the band edge or a single trailing row; delete never jumps to a row above. When that was the **last blank before populated content below** (including **sandwiched** blanks), land on the **lower substantive row visual start** so repeated delete nips that populated row from the front. Delete never lands at content row end above.
- **Delete at probe, substantive row below (last blank before content):** lower content row **visual start** (same as delete collapse exhaustion below).
- **Band edge no-op:** backspace/delete only no-op when there is nothing to merge in that direction **and** no substantive row to land on (e.g. doc end with trailing blanks only).

## Left / Right — horizontal only

- Move one logical step along the wire on the **current line** (same primitive as vertical boundary bleed).
- **Pill atomic (horizontal):** step over a pill as one token; never land inside pill interior text via Left/Right.
- **Mention-interior authority (delete / blank-band step):** `step-to-content-row-end` and `row-chip-before-probe` at a blank-band probe land on semantic content row end (`embeddedBlankBandContentRowEndBeforeProbe`), not raw `probe − 1` when that wire is mention-interior. Canonical `normalizeDocPos` **preserves** interior only when no disambiguation hint is supplied on unrelated paths. Ingress repair restores editor authority when DOM drifts to a blank-probe alias at the same wire offset. After a post-mention **whitespace chip**, when substantive content abuts the probe (`embeddedBlankBandSubstantiveContentAbutsProbe`), authority rests on mention-end / content row end (`docPosAtEmbeddedBlankBandProbeAliasLanding`) — not blank-band zwsp paint at the alias wire.
- **Adjacent mentions on one line:** step mention-to-mention here, not with Up/Down (except boundary bleed above).
- **At doc start + Left** or **doc end + Right:** no-op when unhandled (stay at start/end).

## Shared

- **Delete caret policy:** every `applyDocDelete` result passes through `snapDeleteCaretWire` — default interior snap is **directional** (backspace → mention-end, delete → mention-start). **mentionRemoved** snap lands semantic content row end at probes for both directions. **`resolveHandoffNoteDeleteIntent`** is the single delete authority (doc position + direction before any splice; no cross-key context flags). **Content row end above a probe** resolves semantically via `embeddedBlankBandContentRowEndBeforeProbe`: when physical `probe − 1` falls inside a mention atom, landing is **mention-end** on the mention node, not interior. When the row above is **mention-only** (no prefix text on the line), backspace at the probe **in text-node infrastructure** collapses blank infrastructure instead of stepping.
- **DOM boundary mapping:** `domPointToDocPos` applies click ingress Rule 4 at ingress — text-node tails belong to content row end; blank-band probes come only from blank infrastructure DOM. **Paint at probe aliases** (`resolveDomPointAtDocPos`, `domPointAfterWireBreak`) passes **focus doc position** into `embeddedBlankBandAtEmptyContentRowEnd` so cleared content row end paints wire-break `<br>`, not blank-band anchor. **`isEmbeddedBlankBandDeleteProbeWire(doc, wire, focus)`** requires focus when the wire aliases cleared row end — wire-only checks misclassify spacer-chip landing. Delete policy uses the blank-band collapse family in **Backspace / Delete at blank-band probes**.
- **Mention boundary DOM paint:** `resolveDomPointAtDocPos` places committed-pill **start** and **end** boundary carets outside the pill element; only **interior** offsets paint inside pill text. Collapse moves land on probe wire when `probeInfrastructureLanding` is true; mention-end alias at probe (spacer or glued postfix chip) paints mention-end boundary, not blank-band anchor.
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
