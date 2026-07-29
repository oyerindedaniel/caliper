# Handoff note navigation & edit contract

> **WARNING — agents / editors:** This file is **behavior only**. Do **not** add function names, API identifiers, type names, file paths, or code call-shapes. If a rename or API change is needed, fix the code — leave this contract in domain language. Violating that wastes review and will be reverted.

> **WARNING — progressive trash is one ordered principle:** Delete and Backspace clear blanks and content under **one** land order (stated once under **Progressive trash**). Write the order. Do **not** stack parallel “do not / special case / band-edge / wire-nearest” land paragraphs — those invent a second system. **Anything that skips a blank or content row, remounts CRE while a nearer empty remains in the key’s active direction, or lands by blank-wire-nearest instead of adjacent visual row, is wrong.**

Collapsed caret only unless a section says otherwise. **Doc/wire line** = segment between `\n` characters (storage). **Visual row** = what the user sees (soft wrap, wire break, or blank).

**Authority split (scale):** caret meaning is **doc position + affinity** when one character has two meanings. **Wire** is export and mutation transport only — never the owner of paint, row, or which alias wins.

**Firm rule — wire is ambiguous; do not use it alone:** the same wire offset can be a navigable empty **stop**, a blank **probe**, both (coincident), or a content-row end. Sibling bare `<br>` and blank-anchor can serve **different** stops in one band. Never decide which blank row, paint seat, click lander, or arrow hop from **wire shape / dock kind / sibling presence** without **doc position (+ affinity)** that names the stop or probe. Using wire-only heuristics where that ambiguity exists is a contract violation — fix identity, don’t glue emit/paint.

---

## Shift+Enter (soft line break)

Editor-owned; browser default is prevented.

Follows the **default soft line-break contract** of typical text fields and chat editors (Slack, Discord, Notion, etc.):

- Insert `\n` at the caret (or before an atomic `@` pill when the caret is on the pill start).
- **Caret lands on the new blank at or after the break** — on the inserted line, ready to type. Paint that stop on the **blank-anchor** (ZWSP), not a bare wire-break with empty caret geom — even when the row above ends in a letter (no trailing space). Sole-char content-row line-box geom may still use bare `<br>` when that CRE dock is painted; that is not the Shift+Enter typing stop.
- **Caret never regresses** to an earlier offset on the same break (no backward jump to the previous visual row’s content end).
- Consecutive Shift+Enter presses advance monotonically through blank lines (no freeze).
- **EOF trailing blank band:** when a break extends a blank run at doc end with no substantive row below, caret lands on the **new empty line’s navigable stop** (that line’s line-start wire — often document end after the final `\n`). The next insert fills that visual row; backspace on that blank uses blank-band collapse.
- **Wire newline line box:** wire `\n` paints as a break. When the document ends with `\n`, a **non-wire** DOM line-pad `<br>` opens the **trailing empty line** at `wire.length`. The final wire `\n` is still an empty **line-start stop** when that line slot is empty (coincident probe dock + caret stop) — bare wire-break, no blank-anchor for that probe — and the pad is the **next** empty stop below it. **Do not** collapse those two into one lattice stop or force them onto one nav landing. Do **not** invent a separate **content** row at document end. Up/Down steps every empty stop (visual row = nav stop).
- **One probe → one dock:** for each blank-band probe, dock kind is decided once (bare wire-break vs blank-anchor ZWSP). Emit only that dock. Content-bounded openers that open a navigable stop emit blank-anchor; pad-preceding and blank-only / leading-empty seats that have no opener stay bare wire-break. **Paint is by stop identity, not by “never bare while BA sibling exists”:** a stop whose opener has a blank-anchor paints that blank-anchor; a leading empty with **no** opener paints its **own** wire-break — never the following blank-anchor (that seat belongs to the next stop). Sibling BR+BA may serve different stops; choosing paint from sibling presence alone is the wire-ambiguity violation above. Line-start anchor always precedes its row-start atom — orphan docks are corrupt and must not be remapped to document end or document start.

Mention-boundary breaks (caret on pill start) use the same caret rule: newline before the pill, caret on that new blank — same as whitespace-only inter-pill gaps.

---

## Up / Down — vertical only

- **One keypress = one visual row**, whether from soft wrap, a wire `\n`, or a Shift+Enter blank.
- **Vertical goal column** (measured X) sticks across consecutive Up/Down on **content rows**. Typing / doc mutation, click (user reposition), and horizontal arrows **set** sticky to the painted caret X at that moment (not clear-then-remeasure on the next Up/Down). Crossing an **embedded blank band** resets goal to that blank’s visual start (see blank rules). Vertical clamp sticky still comes from the vertical move’s `goalColumn` — do not remasure over a clamped land.
- **Measured start column (sticky unset):** live DOM caret X owns the start column (soft-wrap multi-fragment carets use the lowest painted fragment). **`focusAffinity` must be applied** when measuring (`after` = after-glyph X, not char-start). Layout’s measured sample for the focus is fallback only when DOM is unavailable. Editor sticky still wins when set.
- **Content rows — preserve column:** land at the sticky goal on the target row (pill half-split when X is inside a pill; else geometric DOM probe); **clamp** if the row is shorter via hit-test onto the last caret. If sticky X is past the target row’s content, land at that row’s **content end** (last valid caret — text end or pill end). Do not land in empty layout past content. Content-end lands use the same **content-row-end (`after`)** meaning as horizontal onto that char — not omit / `before`. When the probe hits the ambiguous last content char, pick on-char vs after-glyph by which painted X is nearer sticky (no tolerance fudge). Packaging never stamps `after` just because the wire is the last content char.
- **Sticky after clamp:** keep the pre-clamp goal when the target is a **post-mention soft-wrap continuation**, or when moving **Up** into a shorter row separated only by **same-wire soft wrap** (no embedded `\n` between the rows). Mid-text soft wrap needs a real column probe; boundary samples omit interior columns.
- **Content rows — row start:** when sticky goal is at the visual left edge, land at that edge on the target — not the previous row’s end, not max-tail of another row.
- **Wire `\n` segments** are storage only — they do not choose the step. They matter for **which doc offset** matches the target visual row + goal column.
- **Mention atomicity:** never land inside a pill. Goal X strictly inside a pill’s painted span → **pill start** (left half) or **pill end** (right half), same for Up and Down. Past the pill → text at that column.
- **After geometry picks a target:** land on the **paint owner** for that focus (alias seams: doc focus → paint owner → geometry — not raw wire).
- **From content:** enter the first visual row below (including empty rows); do not jump to a later mention on the current row.
- **Boundary bleed (Clash-style):** when **no visual row** remains above/below, vertical falls through to **horizontal** on the current row — not a silent no-op.
  - **First visual row + Up** → same as **Left**.
  - **Last visual row + Down** → same as **Right**.
  - Multiline docs: bleed only at true visual top/bottom once layout is exhausted.
- **Mid-document:** Up/Down never substitute horizontal motion; only at visual extremes.
- **Resolution order:** (1) move to an adjacent visual row when one exists; (2) otherwise boundary bleed at true top/bottom; (3) otherwise unhandled (browser may take the key). Geometry-first via DOM column probe (and pill half-split); interior column without a probe is not the UX contract.
- **Sparse samples:** bracket unsampled offsets to a visual row for **layout row inference** only. Column on content rows is pill half-split or DOM probe — not a second sparse edge snap for Up/Down. **Same-wire soft-wrap band:** adjacent content rows with no `\n` between their wire ranges. An upper-row sample on a `\n` is a wire-line break, not soft wrap.
- **Soft-wrap band partition:** for a soft-wrapped wire-line segment, visual bands cover every wire from segment start through segment end with **no gaps**. When acquire samples skip glyphs between the last upper-band sample and the first lower-band sample, those unsampled wires belong to the **continuation** band — not the prefix, and not linear Y interpolation across the wrap.
- **Post-mention soft-wrap tail:** text after a mention that wraps entirely to the next visual row is a continuation row (column from that fragment), not the pill band. **Not** the same as a whitespace-only gap painted on a different row from its following atom (cross-row inter-atomic spacer — paint/row authority, not wrap-continuation promotion). When measured geometry shows **three or more** distinct tops in that post-mention run, each band stays its own visual row — do not flatten deeper bands onto the first continuation top or smash their columns to the first continuation’s start X.
- **Wire-newline row visual start:** substantive text after an embedded `\n` (normal break, not blank band) has a line-start column at the **start of that line** — never copy a longer row’s past-end column onto the first character.

### Embedded blank bands

Stacked empty **visual** rows (Shift+Enter empty lines and empty open). **Visual row is the authority for Up/Down.**

- **Line array (scale):** a document is a sequence of **lines** separated by `\n`. Line count is always **newlines + 1** (including a leading empty line and a trailing empty line after a final `\n`). An empty open document is **one** empty line (no `\n` yet). That opening empty line does not disappear when Shift+Enter adds further empty lines.
- **Blank navigable stops = empty line slots** at each empty line’s **line-start wire** (including document end when the wire ends in `\n`). Line count is newlines + 1. Empty open is one stop `[0]`. Each Shift+Enter adds one empty stop — empty open + 3× Shift+Enter (`"\n\n\n"`) → four stops `[0,1,2,3]`. Blank-only `"\n\n\n\n"` → `[0,1,2,3,4]`. Content-bearing `"header\n\n"` → `[7,8]`. `"header\n\n\n"` → `[7,8,9]`. Probe wires remain delete/paint docks; when a probe coincides with an empty line-start it is the same caret stop — no probe↔length alias glue that drops a visual row.
- **Unique seat per blank stop:** every navigable empty line needs its own hit-testable paint seat. Mid-doc stops use the opener’s blank-anchor when emitted; leading / coincident empty seats may use their bare wire-break. The trailing empty at `wire.length` uses the line-pad BR. The final wire `\n` empty line-start (when it is a stop) paints its own bare break — **not** the pad, and **not** dropped from the lattice. Read-back from a seat is that empty line’s **stop**.
- **Line break vs blank line:** `\n` means “start next line,” not “insert a blank.” A blank line appears when that line’s segment is empty (`a\n\nb` → `a`, blank, `b`). The blank is the empty line slot, not the `\n` character by itself.
- **One blank visual row:** one empty line the user sees. Consecutive Shift+Enter empties each advance the caret through those rows monotonically.
- **Not an extra blank row:** a `\n` that only starts the next **substantive** line is line-start storage for that content row — not a second empty stop.
- **Blank-band column:** empty rows have no interior column — land at **visual line start**. Entering a blank **resets** sticky goal to that start. Blank → blank stays at start. Blank → content lands at the content row’s **visual start** — do not carry a prior content end column through the band.
- **Example:** `header\n\ntail` — three visual rows. From end of `tail` at visual start: Up → blank start; Up → header start. From a later column on `tail`: Up → blank at visual start (sticky resets). Not four rows; not a stop on the `\n` before `tail` unless that row is visually empty.
- **Example (blank-only):** open empty → one empty line. Three Shift+Enter → four empty lines (`"\n\n\n"` → stops `[0,1,2,3]`). Up from the last empty line steps to the previous empty stop (one row), never skips by dropping the pad-preceding line-start from the lattice.
- **Layout order:** by measured visual Y from **one geometry epoch**. DOM acquire measures content, each blank line-start’s **actual caret paint dock** (blank-anchor when emitted; bare wire-break only when that is the stop’s dock), and the trailing empty line (line-pad BR geometry) into the same cached snapshot. A blank stop must not borrow its preceding wire-break geometry: after soft wrap that break remains on the content row and would invert the lattice. Infer materializes **one blank row per empty line slot** from that epoch (or the content-bracket ladder when a slot was not measured) and must **not** remasure blank Y against a cached content epoch — that desyncs the lattice after scroll. Do not mint a **content** row for the trailing empty line. Mention end and following text on the same paint band share one visual row. Down from content skips inline blanks that share the current row’s top. Up steps each **visual** row above, not each wire `\n` alone. Horizontal bleed must not fire while another visual row exists. Doc/width changes invalidate the epoch (blank later populated remasures together).
- **Text caret geom:** for a text paint point, char-offset must use the text range rect — never treat that offset as `root.childNodes[offset]` (that steals a neighboring wire-break BR Y and invents fake soft-wrap rows). Root-offset onto a BR child remains valid for live blank paint.

### Wire `\n` classification for layout

On the wire, `\n` always means **start next line**. Classify each **line slot** (segment between separators, plus the leading slot and the trailing slot after a final `\n`):

- **Empty line slot** → **blank visual row** with a navigable stop at that line’s start wire (document end when the final segment is empty). Do not collapse consecutive empty lines into one. Do not skip the final wire `\n` line-start when it is an empty slot. Do not invent an extra **content** row for that trailing empty line. Horizontal Right (and vertical Down bleed) from the last empty line does not invent a further stop beyond it.
- **Whitespace-only or substantive text** → **content visual row**. Typed spaces leave blank-band ownership — those spaces are ordinary characters. Distinct measured top per content wire line inside embedded text — do not fold a whole multiline text node into one visual row.
- **Soft wrap inside a wire line:** a wrap on an earlier segment remains its own visual row even when the same text run later contains hard breaks. A later `\n` does not cancel wrap rows on the segment above it.
- **Post-atomic prefix snap:** aligning text immediately after a mention onto the pill midY applies only to samples already on that band. Soft-wrap continuation tops measured below the pill inside the same wire line must stay distinct (do not flatten the whole prefix-until-`\n` range onto the pill).

---

## Click ingress

Editor-owned reconciliation after user click. Does **not** change Backspace/Delete blank-band policy.

### Paint vs wire (alias seams)

When the same wire aliases multiple doc owners (mention boundary vs spacer tail, probe vs content-row end), **paint, layout row, and caret kind follow focus doc position → paint owner → geometry** — not raw wire alone.

- Incoming/from authority wins on the same wire when it already names an owner (selection, click repair, DOM read-back).
- Otherwise pick the structural owner at that seam (e.g. atomic end prefers following text when that text owns the paint; cross-row inter-atomic spacer tail only when spacer and following atom sit on **different** visual rows).
- Cross-row inter-atomic spacer is **not** soft-wrap continuation: click uses focus/paint row, not “continuation in the row above” rules meant for wrap tails.
- Typed `@` immediately before/after a committed pill: never glue `@@id`; land on the typed `@` so an empty mention session can open — not on the mention-boundary alias.

### Click rules

- **Rule 1 — click wins:** If a click resolves to a valid DOM text position on the editor, **accept it**.
- **Rule 2 — repair scope:** Repair only when the click lands in an **invalid or unrepresentable** region (e.g. pill interior, outside root) — not when live reads as a blank probe but DOM still resolved meaningful text on the intended row.
- **Rule 3 — no regress:** Repair must **never** move the caret farther from the click target when a valid position already exists.
- **Rule 4 — text-node tail ownership:** The trailing edge of a substantive content text node (browser at end of that node’s text) maps to **content row end** — the **last character on that row** — not the following `\n` or blank-band infrastructure. Blank-band stops apply only when selection is actually in blank infrastructure (or an explicit blank land).

  **Write paint:** content row end (`after`) focuses that **last character** and paints at the browser text **tail** (insertion point after it) — including sole-char, whitespace-only, and EOF last char. The `\n` itself always paints via the break path — never as a text-tail stand-in for content row end. Omit and `before` paint **on the character**, not the text-tail.

  **Sole/last char of a row — two meanings:** the last content char before `\n` **or** at EOF can mean **visual start / deletion point** or **content row end**. Selection carries affinity so Delete / blank / insert stay correct — affinity is **not** a license to invent an extra horizontal arrow stop:
  - **`before`** — visual start (paint on char; insert at char; Delete’s unit ahead **is that char**). Backspace uses unit behind (does **not** chip this char).
  - **`after`** — content row end (paint text-tail; insert after char; Delete’s unit ahead is the following break / blank / join, or EOF noop). Backspace’s unit behind **is that char** (chips it).
  - **Omit** — unspecified on that char — **not** content-row-end. Paint on the character (not text-tail). Same Backspace/Delete gate as `before` until `after` is established. Insert omit→append is a **separate insert rule** only — not a paint or selection license to stamp `after`. Delete must not invent blank collapse without established `after`.

  **Delete = unit ahead; Backspace = unit behind.** Reconcile may recover `after` from a native text-tail **only when affinity is unknown and the ingress is user reposition (click / selectionchange)**. Intentional navigation or edit writes that already carry omit / `before` / `after` **keep that authority** — DOM must not upgrade omit → `after`. In-row Backspace/Delete stay at the deletion point (`before`). Leftover commit-space after atomic remove lands `before`. Blank-fill / continued typing / row-chip onto substantive content-row-end land `after`. Insert authority on a non-probe `\n` after content must not be collapsed one character behind by last-char read mapping.

- **Resolution order:** (1) accept strict live when it represents the click; (2) else viewport hit at click coordinates when representable; (3) else accept live with paint owner. Sticky column / row-end helpers are for **vertical** stickiness, not click override.

Industry norm: **click location wins** unless the DOM cannot represent it. “Content row end above band” is **delete policy**, not click repair.

---

## Backspace / Delete

Editor-owned. **One intent authority:** meaning from **doc position + direction + affinity** before any splice. Overlay supplies disambiguated focus; it does not invent a second delete kernel.

### Principles

- **Delete = forward (unit ahead); Backspace = backward (unit behind).** On the last content char of a row (`\n` or EOF): `after` → Delete looks past the char (blank / join / EOF noop) and Backspace’s unit behind is that char; `before` / omit → focus stays on the char (Delete nips it; Backspace uses generic unit-behind). Insert omit→append is separate — not that gate.
- **One unit per key** on a collapsed caret. Range delete removes the highlight (both keys same).
- **Mentions are atoms.** Backspace at mention start with a mention immediately left removes the **left** pill; Delete at mention start removes the **right** pill.
- **Paint vs intent:** same wire may alias probe infrastructure and content-row end. **Intent** uses structure + focus. **Paint** names the **stop** (or CRE alias), then the dock that seat owns: opener’s blank-anchor when that probe opens this stop; bare wire-break when the stop has no opener (leading empty) or when emit left that probe bare (pad-preceding, blank-only, sole-char abutting). **Emit** matches the dock for each probe: blank-anchor for every content-bounded opener that opens a navigable stop (including band-head after chip); bare when blank-only / sole-char abutting / final wire before EOF pad. Do **not** paint “the BA after this BR” for a leading stop — that BA is the **next** stop’s seat. Content row end with text still on the row focuses the **last character** — do not remap the break wire itself to a text-tail.

### Probe classification (structural)

- **Delete-probe:** caret on blank-band infrastructure — that blank visual row owns the unit. One blank-row `\n` per keystroke (never the populated row above/below on the same stroke).
- **Empty content row end:** cleared row / band-head dock under content — chip semantics, not interior mid/tail probes. Clearing the last unit on a content row never collapses the blank on the same keystroke.
- Interior band mid/tail and EOF trailing-band tail stay delete infrastructure when focus is on that infrastructure.

### Content row chip and landing

- Chip removes trailing row text before a blank band normally. Deleting the last character does **not** promote into blank **delete-probe** intent on that same stroke.
- Emptied chips that fuse into the leading blank under content land that **band-head** stop; mid-fusion empties keep semantic content-row-end. Fuse from **post-delete topology**, not a deleted-char whitespace sniff.
- Partial chip leaving sole-char text: caret on that **char** with content-row-end (`after`), not probe paint. Sole remaining substantive char never aliases CRE onto the probe wire.
- A blank collapse advances to the **next remaining unit in that key’s direction**: Backspace goes up/behind; Delete goes down/ahead. That directional advance may land on an adjacent blank stop or a content-row end/start. It is not a cross-side pivot.
- Atom and content-row aliases matter when selecting an actual content unit, including Backspace landing at the upper row end before it chips the character behind.
- Blank visual line-start and probe-dock entries both collapse one blank unit. Delete intent alone owns the global EOF/BOF pivot.

### Row-chip when

- **Delete** chips when caret is on the content char immediately before a blank-band probe.
- **Backspace** chips that char only with affinity `after`, or when caret is on the probe with a content-row alias. Visual-start Backspace (`before` / omit) never chips the focused char ahead — unit behind or BOF noop.
- **≤2-char same text-node rows** at visual start: interior backspace nibble (char behind caret). Multi-char blank infrastructure without alias: collapse, not chip.

### Progressive trash (one principle — both keys)

**One system.** Either Delete alone or Backspace alone empties the note without manual caret moves. Keys never flip: Delete chips **ahead**, Backspace chips **behind**. After each stroke, selection advances to the next remaining unit in that same direction. Only after its global direction is exhausted does the key pivot once to traverse the remaining side.

**Collapsed-row identity:** the blank row removed is the caret’s blank **visual row** (including EOF pad stop). Opener-probe mid-stop coincidence is not a substitute identity when the caret owned the pad stop.

**Visual-row seat lattice:** measured seats identify directional blank-collapse neighbors and the one global EOF/BOF pivot. A soft-wrap continuation is a landable seat like a hard-break row. The live editor supplies measured seats; headless tests supply wire-line seats.

**Order — primary side, one pivot, then continue:**

1. Stay on the primary side until that side has nothing left. Delete primary = **down / ahead**. Backspace primary = **up / behind**.
2. Directional advance may cross adjacent visual rows only in the active direction; it must never jump over an available unit on that side.
3. Delete at EOF pivots to the first visual seat. Backspace at BOF pivots to the final visual seat (a blank stop, or the final content-row end with `after`).
4. After that pivot, continue in the same key direction until empty; do not make a second cross-side pivot.

**Land at the one pivot** (only when a Delete/Backspace stroke leaves no unit in its global direction):

- **Delete:** EOF pivots to the first visual seat, which may be a blank stop or content visual start.
- **Backspace:** BOF pivots to the final visual seat: a blank stop when the final row is blank, otherwise the final content-row end with `after`.

**On a blank row:** that key nips that blank only (one blank-row `\n` per stroke).

**When nothing remains** for that key’s progressive chain, the stroke is a no-op (empty doc, or a missing measured pivot seat). A sole trailing blank under content (`TOP\n`) is not done: collapse it and continue. Sole leftover prefix blank clears to empty on Delete (same end state as Backspace).

**Anything that does not obey this order is wrong** — including a jump over an available primary-side unit, a cross-side remount before the global boundary, a second pivot, or any band-edge / special-case land paragraph that invents a second system.

**Other blank / break paths (same land order — not a second system):**

- Blank visual line-start stops that are not probe docks use the same stop→opener collapse entry as Backspace for Delete entry (probe-coincident stops stay on the probe / empty-CRE path). Delete land after collapse stays Delete land (visual start / blank below) — never Backspace’s CRE land.
- **Line-start collapse (Backspace):** `\n` before lower substantive content when every segment above is empty — keep the backward deletion point.
- **Substantive line-break join:** single `\n` with populated rows on both sides merges on backspace at lower visual start or delete on the break; caret at join.
- Leading blank under content (band head) is empty content row end for click/chip.

### Directional nibbling (in-row)

- **In-row text:** backspace behind; delete ahead; caret stays at the deletion point until the one global pivot. A surviving horizontal spacer at the deletion point is the next Delete unit even when reflow removes its former visual-row seat. Sole/last content char before `\n` (including leftover commit space) keeps `before` so the next insert/paint stay at visual start — not content-row-end text-tail. At visual start of a populated row, backspace does not nip that row’s text; at content row end, delete does not nip further on that row without moving.
- **Inter-atomic gap:** whitespace-only text between two atoms (no newline, no substantive chars). Substantive text between atoms is ordinary text.

---

## Left / Right — horizontal only

**Authority:** one **visual stop** per key. Horizontal owns the stop list — not raw wire±1, and not a second author that stamps meaning after the step. Wire is transport; blank vs line-start classification is the same as vertical (empty segment = blank stop; `\n` that only starts the next substantive line is storage, not a hop).

- One logical step (same primitive as vertical boundary bleed at row ends).
- Land on the **paint owner** after the step (doc-primary step, then paint). Text steps inside a text node; atoms step as whole tokens — never land in pill interior via Left/Right.
- **Between-character feel:** caret lives in the gaps. One Right/Left moves one gap: letter→letter, letter→spacer, spacer→next unit. Trailing spaces are ordinary text hops — not skipped.
- **Content-row-end (`after`)** is a **same-wire meaning flip** on the last content char of a row (`\n` or EOF), never fused into “step onto that char”:
  - **Right** from the previous unit onto that last char lands the char at the **deletion point** (omit / `before`) — one visual gap, same as any other character.
  - **Right** while already on that char with omit / `before` establishes `after` (Backspace-ready). **Left** from `after` returns `before`. **Left** from omit / `before` leaves to the previous unit.
  - **Right** from established `after` leaves to the next **visual** stop: blank row, next content row visual start, or EOF no-op. Do not invent a caret at wire past-end for row-end meaning.
- **Blank rows (horizontal):** same rule as vertical — one empty segment between breaks is one blank hop. Enter blank from the row above in one Right; leave blank to the next content visual start in one Right. Do **not** stop on probe-only docks or on the storage `\n` that only starts the lower content row — caret identity is the empty line-start stop. Left mirrors.
- **Ordinary line break (no blank):** `a\nb` has two content rows — Right from end of `a` lands visual start of `b` in one step (the `\n` is not a horizontal stop).
- **Alias:** when step focus is atomic end and paint owns following text at the same wire, selection is that text owner so the next Right can enter a spacer.
- **Soft-wrap spacer vs click:** wrap-tail spacer and continuation are **separate** horizontal stops. Click may land continuation; one Right must not skip spacer→continuation. Same-row sandwich spacers stay a real stop. Left from continuation lands the spacer.
- Right from text immediately before an atom crosses the atom to post-text paint (no mention-start micro-stop). Mention **start** remains landable when already focused there.
- **At doc start + Left** or **doc end + Right:** no-op when unhandled.

---

## Shared principles

- **After delete:** intent owns final caret. Atomic remove onto blank under content → content-row-end (`after`) when that is the structural land; leftover commit space → deletion-point (`before`). Interior escape out of a pill is directional (backspace → atom-end, delete → atom-start) — not a second landing author.
- **Break paint:** every focus on `\n` uses the break path (bare break, blank dock, or line-start anchor as geometry requires). Content row end with text still on the row focuses the last character.
- **Row-start atom:** a non-wire line-start dock may exist so atom-start has a paintable caret; break-wire focus on the preceding `\n` still paints the break.
- **Mid-row spacer tails** stay text paint — do not rewrite to atom exterior.
- **Blank-fill insert:** type into a blank inserts after the blank stop; caret rests on the **last inserted char** (content row end) with row-end meaning for the next key.
- **Mentions:** vertical crosses rows; horizontal crosses tokens on a row.
- **`@query` session:** caret on a content character means insert **after** that character for parse. Committed pills are never sessions; focus on mention boundary/interior closes/rejects session.
- **Mention commit:** pad a commit space unless one already follows (`\n` is a row break, not a pad). Land on the first post-atom content char as ordinary content-row-end (`after`).
- **Atoms:** new atom types use generic atomic rules (boundary, paint alias, horizontal step) — no per-type horizontal shim. Inter-atom whitespace is **inter-atomic gap**, not mention-only vocabulary. Seam classification is atom-generic; mention words stay for product facts (pill UI, session, mention edit).
- **Tests:** assert **this contract’s behavior**, not implementation branches. Failing test → fix code or wrong oracle — never weaken the contract to green a patch.

---

## Not in scope

- Shift+arrow selection ranges
- Browser default when the handler leaves the key unhandled
- Mention popover keyboard (separate controller)

## Pill click selection

- **Click pill:** select that **doc node instance** only; native caret cleared; tray may still highlight by agent id.
- **Highlight in note:** by **node index**, not agent id — duplicate `@` pills do not all light up.
- **First arrow after select:** vertical → **row start** of that pill’s line; horizontal → **pill end**; then normal caret navigation.
- **Clear selection:** text mousedown, typing, doc mutation, `@` popover open, or arrow exit.
- **Popover open:** list arrows stay on popover; editor pill exit suppressed; pill selection cleared on popover input.
