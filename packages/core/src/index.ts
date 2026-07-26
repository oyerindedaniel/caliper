export { createReader, type Reader } from "./scheduling/reader.js";
export {
  createFrequencyControlledReader,
  type FrequencyControlledReader,
} from "./scheduling/frequency-control.js";
export { createSuppressionDelegate, type SuppressionOptions } from "./scheduling/suppression.js";
export {
  isVisible,
  hasSize,
  isEligible,
  isEditable,
} from "./element-picking/utils/filter-visible.js";
export {
  detectContext,
  resolveAmbiguousContext,
  getElementAtPoint,
  getTopElementAtPoint,
} from "./cursor-context/utils/priority-rules.js";
export * from "./geometry/utils/scroll-aware.js";
export {
  type MeasurementResult,
  type MeasurementLine,
  createMeasurementLines,
  getLiveLineValue,
  getLivePoint,
} from "./measurement-model/utils/measurement-result.js";
export {
  isSameMeasurementContext,
  type SameMeasurementContextInput,
} from "./measurement-model/utils/measurement-context.js";
export {
  getMaxProjectionDistance,
  getProjectionLineGeometry,
  type DocSize,
  type ProjectionViewport,
  type ProjectionLineGeometry,
  type ProjectionLineGeometryInput,
} from "./measurement-model/utils/projection-geometry.js";
export {
  resolveLiveLineEndpoints,
  resolveMeasurementLabelPosition,
  type LiveLineSyncData,
  type ResolveLiveLineEndpointsInput,
  type ResolvedLiveLineEndpoints,
  type MeasurementLabelPosition,
  type MeasurementLabelPositionInput,
  type VisibilityWindow,
} from "./measurement-model/utils/live-line-render.js";
export {
  createMeasurement,
  createMeasurementBetween,
} from "./measurement-model/utils/create-measurement.js";
export {
  createMeasurementSystem,
  type MeasurementSystem,
  type MeasurementState,
  type MeasurementSystemListener,
} from "./measurement-model/utils/measurement-system.js";
export {
  createHandoffRegistry,
  type HandoffRegistry,
  type HandoffRegistryItem,
  type HandoffRegistryListener,
  type HandoffCommitListener,
  type HandoffUIState,
  type HandoffPresentation,
  type HandoffElementResolver,
} from "./handoff-model/utils/handoff-registry.js";
export { readPersistedHandoff, persistHandoff } from "./handoff-model/utils/handoff-session.js";
export {
  resolveHandoffNote,
  isHandoffPendingNoteEmpty,
  isExactHandoffMentionQuery,
  resolveActiveHandoffMentionQueryDoc,
  exclusiveWireEndForContentCaret,
  type ActiveHandoffDocMentionQuery,
  handoffItemLabel,
  filterHandoffItems,
  handoffResolvedNoteToWire,
  formatHandoffAgentIdPill,
  type HandoffAgentIdPillVariant,
} from "./handoff-model/utils/handoff-note.js";
export {
  wireToDoc,
  parseHandoffNoteWire,
  HANDOFF_AGENT_ID_PATTERN,
  HANDOFF_MENTION_PATTERN,
  docToWire,
  docLength,
  isEmptyDoc,
  createTextDoc,
  emptyHandoffNoteDoc,
  resolveDocPosition,
  offsetAtDocPosition,
  spliceDocWireRange,
  insertMentionAt,
  separateAdjacentMentions,
  normalizeHandoffNoteDoc,
  canonicalizeHandoffNoteDocFromWire,
  docsEqual,
  resolveHandoffNoteMentionEdit,
  resolveHandoffNoteArrowMove,
  describeHandoffNoteCursorContext,
  snapHandoffNoteCursorOutOfMentionInterior,
  resolveHandoffWireCursor,
  type HandoffNoteEdit,
  type HandoffNoteArrowDirection,
  type HandoffNoteNavDirection,
  isArrow,
  type HandoffNoteCursorContext,
  type HandoffNoteDoc,
  type HandoffNoteNode,
  type HandoffNoteTextNode,
  type HandoffNoteMentionNode,
} from "./handoff-model/note-doc/handoff-note-doc.js";
export {
  collapsedSelection,
  cloneDoc,
  cloneSelection,
  docEndPos,
  docPosEqual,
  docPosToRenderedChildIndex,
  docPosToWireOffset,
  expandSelectionFocusToDocEndIfNeeded,
  docSelectionToWireRange,
  docsStructurallyEqual,
  mentionCountInDoc,
  nodeTokenLength,
  normalizeDocPos,
  normalizeSelection,
  renderedChildCount,
  resolveDocVerticalArrowMove,
  isAtomicNode,
  isInterMentionAtomStart,
  snapInterMentionAtomLanding,
  docSelectionToWire,
  selectionsEqual,
  wireOffsetToCollapsedSelection,
  wireOffsetToDocPos,
  caretAffinityForAmbiguousBreak,
  collapsedSelectionCarryingAffinity,
  collapsedSelectionReconcilingAffinity,
  collapsedSelectionWithIntent,
  docPosAfterAmbiguousContentRowEndChar,
  focusAffinityIfAmbiguousBreak,
  isCaretOnAmbiguousContentRowEndChar,
  isCaretOnContentCharBeforeNewline,
  resolveDirectionalUnitFocus,
  type DirectionalUnitFocus,
  type DocPosBias,
  type HandoffNoteCaretAffinity,
  type HandoffNoteDocPos,
  type HandoffNoteSelection,
} from "./handoff-model/note-doc/handoff-note-doc-pos.js";
export {
  resolveWireLineColumn,
  type HandoffNoteVerticalArrowDirection,
  type WireLineColumn,
} from "./handoff-model/note-doc/handoff-note-wire-lines.js";
export {
  resolveVerticalArrowWireMove,
  resolveVerticalArrowCrossLineMove,
  resolveVerticalArrowRowStartLanding,
  resolveVerticalArrowMinWireLineStart,
  resolveHorizontalBleedWireMove,
  type VerticalNavLineSpan,
  type VerticalNavWireMove,
} from "./handoff-model/note-doc/handoff-note-vertical-nav.js";
export {
  applyDocDelete,
  applyDocInsertText,
  applyDocLineBreak,
  insertMentionAtSelection,
  spliceDocSelection,
  type HandoffDocEditResult,
} from "./handoff-model/note-doc/handoff-note-doc-edits.js";
export {
  docTextNodeHasEmbeddedNewline,
  docPosAtEmbeddedBlankBandProbeAliasLanding,
  resolveRowChipLanding,
  embeddedBlankBandAtEmptyContentRowEnd,
  embeddedBlankBandContentRowEndBeforeProbe,
  embeddedBlankBandSubstantiveContentAbutsProbe,
  embeddedBlankBandProbePaintsBareWireBreak,
  embeddedBlankBandProbeEmitsBlankAnchor,
  blankBandOpenerProbeForStop,
  blankVisualLineStartOpenedByProbe,
  embeddedBlankBandSpacerBeforeProbeRowChip,
  embeddedTextLedLowerRowSpanAfterBlankBand,
  isEmbeddedBlankBandCollapseProbeWire,
  isEmbeddedBlankBandProbeWire,
  isInlineSuffixBlankProbeWire,
  isWireOnEmbeddedTextLedLowerRowAfterBlankBand,
  listEmbeddedBlankBandGroups,
  listEmbeddedBlankBandProbeWires,
  listBlankVisualLineStartWires,
  listVisualRowAnchorWires,
  docPosAfterBlankBandCollapse,
  resolveBlankVisualLineStartCollapse,
  resolveEmbeddedBlankBandCollapse,
  isTrailingNewlinePastEndWire,
  embeddedBlankBandRowAboveProbeIsEmpty,
} from "./handoff-model/note-doc/handoff-note-embedded-newlines.js";
export {
  HANDOFF_COLOR_COUNT,
  HANDOFF_PALETTE,
  assignColorIndex,
} from "./handoff-model/utils/handoff-colors.js";
export { sanitizeHandoffSelection } from "./handoff-model/utils/sanitize-handoff-selection.js";
export {
  resolveHandoffPanelPosition,
  type HandoffPanelPosition,
  type HandoffPanelPositionInput,
} from "./geometry/utils/handoff-panel-position.js";
export {
  createSelectionSystem,
  type SelectionSystem,
  type SelectionMetadata,
} from "./measurement-model/utils/selection-system.js";
export {
  createCalculatorState,
  type CalculatorState,
  type CalculatorOperation,
  type CalculatorAction,
} from "./calculator-model/utils/calculator-state.js";
export {
  createCalculatorIntegration,
  type CalculatorIntegration,
} from "./measurement-model/utils/calculator-integration.js";
export {
  createProjectionSystem,
  type ProjectionSystem,
} from "./measurement-model/utils/projection-system.js";
export { createRulerSystem, type RulerSystem } from "./ruler-model/utils/ruler-system.js";
export type {
  CursorContext,
  SyncSource,
  ProjectionDirection,
  ProjectionState,
  RulerLine,
  RulerState,
  CaliperCoreSystems,
  OverlayInstance,
  CaliperPlugin,
  ScrollState,
  Remap,
  PositionMode,
  StickyConfig,
} from "./shared/types/index.js";
export { type ProjectionListener } from "./measurement-model/utils/projection-system.js";
export { type RulerListener } from "./ruler-model/utils/ruler-system.js";
export * from "./shared/constants/index.js";
export * from "./shared/math/index.js";
export * from "./shared/config/overlay-config.js";
export type {
  CalculatorShortcuts,
  ProjectionShortcuts,
  CaliperAgentState,
} from "./shared/config/overlay-config.js";
export type { CaliperHandoffState } from "@oyerinde/caliper-schema";
export {
  applyTheme,
  mergeCommands,
  mergeAnimation,
  mergeTheme,
  getConfig,
  setConfig,
} from "./shared/config/config-utils.js";
export { showVersionInfo } from "./shared/utils/version-check.js";
export { lerp, lerpRect } from "./shared/utils/math.js";
export { generateId } from "./shared/utils/id.js";
export { getElementDirectText } from "./shared/utils/text-content.js";
export { getOverlayRoot } from "./shared/utils/dom-utils.js";
export { filterRuntimeClasses } from "./shared/utils/class-filter.js";
export { buildSelectorInfo, caliperProps } from "./shared/utils/selector.js";
export { resolveElementFromFingerprint } from "./shared/utils/fingerprint-resolve.js";
export { waitPostRaf } from "./shared/utils/raf.js";
export { logger, createLogger, formatElement, formatRect } from "./shared/utils/logger.js";
export { getNormalizedModifiers, getLogicalKey, isKeyMatch } from "./shared/utils/keyboard.js";
