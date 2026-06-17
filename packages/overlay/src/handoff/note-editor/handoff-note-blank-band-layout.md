# Blank-band vertical navigation — pipeline + JSON trace

How ArrowUp/Down works through Shift+Enter blank bands. Contract: [handoff-note-arrow-contract.md](./handoff-note-arrow-contract.md). **Visual row** is navigation authority — not one arrow row per wire `\n`. Implementation may still diverge until probe/layout code is aligned with the contract.

Contract: [handoff-note-arrow-contract.md](./handoff-note-arrow-contract.md)

---

## Sample wire (playground repro)

```text
dh @caliper-ccvpxl3kt d @caliper-ccvpxl3kt \n\ndh @caliper-ccvpxl3kt
│  │                    │ │                    │││ │                    │
0  3                   20 21                   43 44 46              67
```

| Wire  | What                                                                               |
| ----- | ---------------------------------------------------------------------------------- |
| 0–20  | `dh @pill d @pill ` (upper pill row)                                               |
| 43    | empty visual row between upper content and lower row (blank-band probe)            |
| 44    | line-start `\n` before `dh` on lower row — **not** a second blank probe (contract) |
| 46–67 | `dh @pill ` (lower pill row; caret at 67 = end of lower pill)                      |

---

## End-to-end pipeline (one ArrowUp press)

```text
handleKeyDown (create-handoff-note-editor.ts)
  └─ syncSelectionFromDom()           → focus doc pos
  └─ resolveDomVerticalArrowMove()  → selection.ts
       └─ buildHandoffNoteLayoutMap() → layout-map.ts
            ├─ acquireDomMeasuredSamples()  (cache miss: measure → applyDomAcquireSamplePins → appendSoftWrapLineSamples)
            ├─ inferLayoutFromMeasured()
            │    ├─ applyStructuralSamplePins()  (alignMentionAdjacent + pinEmbeddedNewlinePrefixBandTops)
            │    ├─ repairCollapsedMeasuredGeometry()  (synthesizeCollapsed* — headless DOM only)
            │    ├─ buildSemanticBlankLayoutRows()  (frozen content-only ladder basis)
            │    └─ buildDocOrderedLayoutMap()
            │         ├─ cluster content rows (no probe wires)
            │         └─ sortLayoutRowsByVisualTop()   ← navigation order
            └─ log layout.build
       └─ resolveLayoutVerticalArrowMove()
            ├─ rowIndexForWire(fromWire)
            ├─ targetLineIndex = current ± 1
            ├─ resolveVerticalTargetLineIndex()  (Down: skip same-Y blanks)
            └─ blank-row-probe OR pickVerticalLandingOnLine()
  └─ mutateSelection(pos)
```

---

## Stage 0 — User input

**Function:** `handleKeyDown` → vertical branch  
**File:** `create-handoff-note-editor.ts`

```json
{
  "in": {
    "key": "ArrowUp",
    "editorWire": "dh @caliper-ccvpxl3kt d @caliper-ccvpxl3kt \n\ndh @caliper-ccvpxl3kt ",
    "focusAfterSync": { "nodeIndex": 6, "nodeOffset": 1 },
    "fromWire": 67,
    "stickyGoalColumn": 501.29
  },
  "calls": "resolveDomVerticalArrowMove(root, doc, focus, 'up', { stickyGoalColumn })"
}
```

---

## Stage 1 — Core: which `\n` wires are blank-band probes?

**Function:** `listEmbeddedBlankBandProbeWires(doc)`  
**File:** `packages/core/.../handoff-note-embedded-newlines.ts`

Scans every `\n` in the wire string. Each offset is kept only if `isEmbeddedBlankBandProbeWire` is true.

**Rules (in order)** — probes identify **empty visual rows** only, not every `\n` in the wire:

1. `describeLineBreakCaretRun(...).inSuffix` → empty row in mention-adjacent Shift+Enter suffix → **probe** for that visual blank only.
2. Else a run of 2+ consecutive `\n` with **only empty/whitespace lines between substantive content** → one probe per **empty visual row** in the band — **not** the `\n` that immediately precedes the next substantive line (e.g. `header\n\ntail` → one blank probe, not two).
3. Else single `\n` with whitespace-only text on both sides → **probe** (one empty visual row).
4. Else substantive line break (`header\nline1`, or `\n` before next content on the next visual line) → **not a probe**.

```json
{
  "in": {
    "wire": "dh @caliper-ccvpxl3kt d @caliper-ccvpxl3kt \n\ndh @caliper-ccvpxl3kt "
  },
  "perOffset": [
    {
      "wire": 43,
      "char": "\\n",
      "inSuffix": true,
      "isBlankBandProbe": true,
      "note": "empty visual row between upper content and lower row"
    },
    {
      "wire": 44,
      "char": "\\n",
      "isBlankBandProbe": false,
      "note": "line-start before lower content — not a second blank row (contract)"
    }
  ],
  "out": [43],
  "contractExample_headerTwoNewlinesTail": "header\\n\\ntail → probes [6] only; wire 7 is tail line start, not a blank stop",
  "note": "NOT every \\n — wire  would NOT appear here if it were line1\\nline2"
}
```

**Distinct check:** substantive wire-line `\n` (e.g. `line1\nline2`) is excluded by `listEmbeddedBlankBandProbeWires`; blank navigation uses that list only.

---

## Stage 2 — Layout: measure samples

**Function:** `buildHandoffNoteLayoutMap(root, doc, focus)`  
**File:** `handoff-note-layout-map.ts`

### 2a — Get or build `measured[]`

Cache key: `wire` + `rootWidth`. Cache stores an **immutable deep copy** of DOM-acquired content samples (no blank probe wires). Every `acquireDomMeasuredSamples` returns a **fresh clone**; infer mutates a working copy only.

**Function:** `acquireDomMeasuredSamples(root, doc, wire, rootWidth)`

```json
{
  "step": "getCachedMeasuredSamples(wire, rootWidth) OR fresh measure",
  "sampleWireOffsets": "boundary wires: 0, each node start/end, doc end",
  "perSample": "{ wire, top, left } from getDocAnchorRect / pill midY",
  "mutationsBeforeCache": ["applyDomAcquireSamplePins", "appendSoftWrapLineSamples"],
  "applyDomAcquireSamplePins": [
    "alignTextBeforeMentionRows",
    "pinMentionSampleRows",
    "pinAdjacentTextSampleRows"
  ],
  "outMeasured_excerpt": [
    { "wire": 0, "top": 141.04, "left": 347 },
    { "wire": 21, "top": 141.04, "left": 400 },
    { "wire": 42, "top": 177.49, "left": 200 },
    { "wire": 67, "top": 177.49, "left": 501.29 }
  ]
}
```

### 2b — Structural sample pins (every build)

**Function:** `applyStructuralSamplePins(doc, measured, root?)` — includes `alignMentionAdjacentMeasuredRows` and `pinEmbeddedNewlinePrefixBandTops`.

`alignMentionAdjacentMeasuredRows` skips text nodes that contain embedded `\n`. Pulls mention-end wire and post-mention start wire to the same `top`.

```json
{
  "in": { "mentionEndWire": 20, "postMentionStartWire": 21 },
  "out": { "bandTop": 141.1, "bothSamplesTop": 141.1 },
  "log": "layout.mentionAdjacentAlign"
}
```

```json
{
  "in": { "mentionEndWire": 65, "postMentionStartWire": 66 },
  "out": { "bandTop": 177.49 },
  "log": "layout.mentionAdjacentAlign"
}
```

### 2c — Blank rows from probes

**Function:** `buildSemanticBlankLayoutRows(doc, measured, lineHeight, root?)`

**Phase 1 — existence:** one `kind: "blank"` row per contract probe (always).

**Phase 2 — placement:** `top` from a **frozen content-only ladder** (`contentSamplesForBlankLadder`) captured once at the start of the pass. Brackets use floor/ceiling content bands only; blank upserts during the loop do not shift later probes. `wireBreak` supplies `left` when live DOM is available; it does not set sort `top`.

Placement kinds: `inline` | `between` | `trailing` | `leading` | `lattice`.

`pinEmbeddedNewlinePrefixBandTops` skips blank-band probe wires so prefix pins cannot pollute ladder brackets.

```json
{
  "in": { "probeWires": [43, 44] },
  "coordResolution": [
    {
      "probeWire": 43,
      "source": "measureWireBreakCoord(br) OR measured.find",
      "coord": { "wire": 43, "top": 140.67, "left": 0 }
    },
    {
      "probeWire": 44,
      "coord": { "wire": 44, "top": 158.86, "left": 0 }
    }
  ],
  "outBlankRows": [
    {
      "kind": "blank",
      "breakProbeWire": 43,
      "top": 140.67,
      "samples": [{ "wire": 43, "top": 140.67, "left": 0 }]
    },
    {
      "kind": "blank",
      "breakProbeWire": 44,
      "top": 158.86,
      "samples": [{ "wire": 44, "top": 158.86, "left": 0 }]
    }
  ],
  "log": "layout.blankRow"
}
```

### 2d — Content rows (clustering)

**Function:** `buildMapFromMeasured(contentMeasured, rowSeedTops, lineHeight)` inside `buildDocOrderedLayoutMap`

```json
{
  "in": {
    "contentMeasured": "measured[] minus wires {43, 44}",
    "pillMidYs": [141.04, 177.49],
    "rowSeedTops": "cluster(pillMidYs + sample tops)"
  },
  "outContentRows": [
    {
      "kind": "content",
      "top": 141.04,
      "sampleWires": [0, 3, 21, 24, 22]
    },
    {
      "kind": "content",
      "top": 177.49,
      "sampleWires": [42, 48, 66, 67]
    }
  ],
  "problemWithoutBlanks": "wire 42 (suffix space before \\n\\n) can cluster with lower row — blanks must be separate rows"
}
```

### 2e — Sort rows by visual Y (the fix)

**Function:** `sortLayoutRowsByVisualTop([...contentRows, ...blankRows])`

Navigation uses **array index** for Up/Down. Indices must follow **painted top**, not doc wire offset.

```json
{
  "in": {
    "unsorted": [
      { "kind": "content", "top": 141.04, "minWire": 0 },
      { "kind": "content", "top": 177.49, "minWire": 42 },
      { "kind": "blank", "top": 140.67, "breakProbeWire": 43 },
      { "kind": "blank", "top": 158.86, "breakProbeWire": 44 }
    ]
  },
  "sortKey": "top ascending; tie → content before blank; tie → min wire",
  "out": {
    "rows": [
      { "rowIndex": 0, "kind": "blank", "top": 140.67, "breakProbeWire": 43 },
      { "rowIndex": 1, "kind": "content", "top": 141.04, "wires": [0, 3, 21, 24, 22] },
      { "rowIndex": 2, "kind": "blank", "top": 158.86, "breakProbeWire": 44 },
      { "rowIndex": 3, "kind": "content", "top": 177.49, "wires": [42, 48, 66, 67] }
    ],
    "visualRowCount": 4,
    "lineHeight": 24
  },
  "log": "layout.build"
}
```

### Bug that wire-order merge caused (for contrast)

If rows were sorted by **doc wire offset** instead of **top**:

```json
{
  "brokenRowOrder": [
    { "rowIndex": 0, "kind": "content", "wires": [0, 3, 21, 24, 22] },
    { "rowIndex": 1, "kind": "content", "wires": [42, 48, 66, 67] },
    { "rowIndex": 2, "kind": "blank", "breakProbeWire": 43 },
    { "rowIndex": 3, "kind": "blank", "breakProbeWire": 44 }
  ],
  "arrowUpFrom67": {
    "currentLineIndex": 1,
    "targetLineIndex": 0,
    "lands": "dom-column-bracket on crowded upper row → wire 21",
    "skipped": [43, 44],
    "branch": "dom-column-bracket"
  }
}
```

### 2f — `rowIndexForWire(wire)`

**Function:** on `HandoffNoteLayoutMap` — direct lookup from row samples, else bracketing interpolation.

```json
{
  "lookups": {
    "67": { "direct": true, "rowIndex": 3 },
    "44": { "direct": true, "rowIndex": 2 },
    "43": { "direct": true, "rowIndex": 0 },
    "21": { "direct": true, "rowIndex": 1 }
  }
}
```

---

## Stage 3 — Resolver entry

**Function:** `resolveDomVerticalArrowMove`  
**File:** `handoff-note-selection.ts`

```json
{
  "in": {
    "direction": "up",
    "fromWire": 67,
    "goalColumn": 501.29
  },
  "layoutOwesMove": true,
  "reason": "rowIndex 3 > 0 — another visual row exists above",
  "log": "resolve.entry",
  "next": "resolveLayoutVerticalArrowMove"
}
```

---

## Stage 4 — Pick target row index

**Function:** `resolveLayoutVerticalArrowMove`

```json
{
  "step1_rowIndexForWire": {
    "fromWire": 67,
    "currentLineIndex": 3
  },
  "step2_rawTarget": {
    "direction": "up",
    "targetLineIndex": 2
  },
  "step3_resolveVerticalTargetLineIndex": {
    "direction": "up",
    "note": "Up does NOT skip rows — only Down skips same-Y inline blanks",
    "out": { "targetLineIndex": 2 }
  },
  "step4_targetRow": {
    "kind": "blank",
    "breakProbeWire": 44,
    "targetRowWires": [44]
  },
  "log": "resolve.layout"
}
```

### Down-only: skip same-Y inline blanks

**Function:** `resolveVerticalTargetLineIndex` — runs only when `direction === "down"` and current row is **content**.

```json
{
  "scenario": "Down from upper content row, first blank shares top ~141 with pills",
  "in": {
    "direction": "down",
    "currentLineIndex": 1,
    "currentRowTop": 141.04,
    "rawTargetLineIndex": 2,
    "row2": { "kind": "blank", "top": 140.67 }
  },
  "loop": "while next row is blank AND |row.top - current.top| <= tolerance → target++",
  "out": { "targetLineIndex": 2 },
  "note": "If blank 43 had top 141.04 (same band), would skip to row 2 (blank 44)"
}
```

---

## Stage 5 — Landing on target row

### 5a — Blank row → probe wire (no column match)

```json
{
  "condition": "targetRow.kind === 'blank' && breakProbeWire defined",
  "in": {
    "targetRow": { "kind": "blank", "breakProbeWire": 44 }
  },
  "out": {
    "pos": "probed at blank visual line start",
    "handled": true,
    "branch": "blank-band-visual-start",
    "goalColumnOut": "visual start (sticky reset)"
  },
  "log": "resolve.blankLand",
  "whyNotColumnBracket": "Column match on content row would hit wrong row; blank band uses visual start only"
}
```

### 5b — Content row → column / row-start / mention snap

**Function:** `pickVerticalLandingOnLine` (when target is `kind: "content"`)

```json
{
  "in": {
    "targetRow": { "kind": "content", "top": 141.04 },
    "goalColumn": 501.29,
    "atRowStart": false
  },
  "path": "resolveWireAtColumnOnVisualRow(samples, goalColumn) → snapVerticalArrowLanding",
  "out": {
    "branch": "dom-column-bracket",
    "exampleWire": 21
  }
}
```

---

## Stage 6 — Full ArrowUp chain (JSON timeline)

Caret at **67**, goal column **501.29**, four presses Up:

```json
{
  "press1": {
    "fromWire": 67,
    "currentLineIndex": 3,
    "targetLineIndex": 2,
    "targetKind": "blank",
    "toWire": 44,
    "branch": "blank-row-probe"
  },
  "press2": {
    "fromWire": 44,
    "currentLineIndex": 2,
    "targetLineIndex": 1,
    "targetKind": "content",
    "toWire": 21,
    "branch": "dom-column-bracket",
    "note": "goal column 501 preserved on upper content row"
  },
  "press3": {
    "fromWire": 21,
    "currentLineIndex": 1,
    "targetLineIndex": 0,
    "targetKind": "blank",
    "toWire": 43,
    "branch": "blank-row-probe"
  },
  "press4": {
    "fromWire": 43,
    "currentLineIndex": 0,
    "layoutOwesMove": false,
    "bleedGate": "may allow horizontal bleed or wire-cross fallback",
    "note": "true top of doc — contract: bleed Left or wire-cross, not skip blanks"
  }
}
```

_(Press 2 landing depends on column bracketing on upper row — session landed 21 not prefix mention.)_

---

## Stage 7 — Fallback paths (when layout move not handled)

**Order in `resolveDomVerticalArrowMove`:**

```json
{
  "1_layoutMove": {
    "when": "layoutOwesMove && resolveLayoutVerticalArrowMove.handled",
    "wins": "always first for blank-band family"
  },
  "2_wireCross": {
    "function": "resolveDocVerticalArrowMove",
    "when": "hasAdjacentWireLine && layout move failed",
    "note": "wire-line semantics — not step 1"
  },
  "3_bleedGate": {
    "function": "shouldApplyVerticalBoundaryBleed",
    "when": "visual top/bottom OR layout exhausted",
    "multilineDoc": "Up on non-first wire line → bleed blocked"
  },
  "4_fallbackWire": {
    "function": "resolveDocVerticalArrowMove",
    "log": "resolve.fallbackWire",
    "danger": "this caused wire 3 bleed when layout wrongly thought it owed no move"
  }
}
```

---

## Data shapes (types)

```json
{
  "MeasuredWireOffset": { "wire": "number", "top": "number", "left": "number" },
  "HandoffNoteLayoutRow": {
    "kind": "content | blank",
    "top": "number",
    "breakProbeWire": "number | undefined (blank only)",
    "samples": "MeasuredWireOffset[]",
    "minLeft": "number",
    "maxLeft": "number"
  },
  "HandoffNoteLayoutMap": {
    "samples": "MeasuredWireOffset[]",
    "rows": "HandoffNoteLayoutRow[] (sorted by visual top)",
    "visualRowCount": "rows.length",
    "lineHeight": "number",
    "rowIndexForWire": "fn(wire) → rowIndex",
    "coordsForWire": "fn(wire) → MeasuredWireOffset | null"
  }
}
```

---

## Minimal second sample (probe detection only)

```json
{
  "wire": "row @caliper-aaaaaaa \n\n tail",
  "listEmbeddedBlankBandProbeWires": [21, 22],
  "wire": "header tail\nline1",
  "listEmbeddedBlankBandProbeWires": [],
  "reason": "substantive line break — not a blank band"
}
```

---

## What we did NOT add

- No `HandoffNoteBlankSlot` doc node — wire still stores `\n`; probes are **derived** at read time
- No per-ticket resolver names — one family: probes + blank rows + visual sort + `blank-row-probe`

---

## Debug log filters

```text
caret>>ver>>layout.build
caret>>ver>>layout.blankRow
caret>>ver>>layout.mentionAdjacentAlign
caret>>ver>>resolve.entry
caret>>ver>>resolve.layout
caret>>ver>>resolve.land
caret>>ver>>resolve.bleedGate
caret>>ver>>resolve.fallbackWire
```

When Up from lower pill is wrong, check in order:

1. `listEmbeddedBlankBandProbeWires` empty? → core classification
2. `layout.build` row order not by ascending `rowTops`? → `sortLayoutRowsByVisualTop`
3. `resolve.layout` `targetRowKind` not `"blank"` when it should be? → row index / sort
4. `branch` not `"blank-row-probe"` on blank target? → resolver landing
