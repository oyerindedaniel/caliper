/**
 * CDP command responses and event payloads used by @caliper/engine.
 * Shapes follow the Chrome DevTools Protocol — fields we read are required in practice;
 * unused protocol fields are omitted until needed.
 */

/** Chrome /json/list target descriptor (HTTP discovery, not a CDP command). */
export type CdpPageTarget = {
  id: string;
  type: string;
  url: string;
  webSocketDebuggerUrl: string;
};

/** CDP Runtime.RemoteObject — https://chromedevtools.github.io/devtools-protocol/tot/Runtime/#type-RemoteObject */
export type RuntimeRemoteObject = {
  type: string;
  subtype?: string;
  className?: string;
  value?: unknown;
  unserializableValue?: string;
  description?: string;
  objectId?: string;
  preview?: unknown;
  customPreview?: unknown;
};

/** CDP Runtime.ExceptionDetails — https://chromedevtools.github.io/devtools-protocol/tot/Runtime/#type-ExceptionDetails */
export type RuntimeExceptionDetails = {
  exceptionId: number;
  text: string;
  lineNumber: number;
  columnNumber: number;
  scriptId?: string;
  url?: string;
  stackTrace?: unknown;
  exception?: RuntimeRemoteObject;
  executionContextId?: number;
};

/** CDP Runtime.evaluate — https://chromedevtools.github.io/devtools-protocol/tot/Runtime/#method-evaluate */
export type RuntimeEvaluateResponse = {
  result?: RuntimeRemoteObject;
  exceptionDetails?: RuntimeExceptionDetails;
};

/** CDP Page.LayoutViewport — https://chromedevtools.github.io/devtools-protocol/tot/Page/#type-LayoutViewport */
export type PageLayoutViewport = {
  pageX: number;
  pageY: number;
  clientWidth: number;
  clientHeight: number;
};

/** CDP Page.getLayoutMetrics — https://chromedevtools.github.io/devtools-protocol/tot/Page/#method-getLayoutMetrics */
export type PageGetLayoutMetricsResponse = {
  layoutViewport: PageLayoutViewport;
  visualViewport?: PageLayoutViewport;
  contentSize?: { width: number; height: number; x?: number; y?: number };
  cssLayoutViewport?: PageLayoutViewport;
  cssVisualViewport?: PageLayoutViewport;
  cssContentSize?: { width: number; height: number; x?: number; y?: number };
};

/** CDP DOM.Node (subset) — https://chromedevtools.github.io/devtools-protocol/tot/DOM/#type-Node */
export type DomNode = {
  nodeId: number;
  nodeName: string;
  attributes?: string[];
};

/** CDP DOM.getDocument — https://chromedevtools.github.io/devtools-protocol/tot/DOM/#method-getDocument */
export type DomGetDocumentResponse = {
  root: DomNode;
};

/** CDP DOM.querySelector — https://chromedevtools.github.io/devtools-protocol/tot/DOM/#method-querySelector */
export type DomQuerySelectorResponse = {
  nodeId: number;
};

/** CDP DOM.describeNode — https://chromedevtools.github.io/devtools-protocol/tot/DOM/#method-describeNode */
export type DomDescribeNodeResponse = {
  node: DomNode;
};

/** CDP CSS.CSSStyleProperty — https://chromedevtools.github.io/devtools-protocol/tot/CSS/#type-CSSStyleProperty */
export type CssStyleProperty = {
  name: string;
  value: string;
  important?: boolean;
  implicit?: boolean;
  text?: string;
  disabled?: boolean;
};

/** CDP CSS.CSSStyle — https://chromedevtools.github.io/devtools-protocol/tot/CSS/#type-CSSStyle */
export type CssStyle = {
  styleSheetId?: string;
  cssProperties?: CssStyleProperty[];
  shorthandEntries?: CssStyleProperty[];
  cssText?: string;
};

/** CDP CSS.CSSMedia — https://chromedevtools.github.io/devtools-protocol/tot/CSS/#type-CSSMedia */
export type CssMedia = {
  text?: string;
  source?: string;
  sourceURL?: string;
  mediaList?: string[];
};

/** CDP CSS.CSSRule — https://chromedevtools.github.io/devtools-protocol/tot/CSS/#type-CSSRule */
export type CssRule = {
  styleSheetId?: string;
  selectorList?: { text?: string; selectors?: unknown[] };
  origin?: string;
  style?: CssStyle;
  media?: CssMedia[];
};

/** CDP CSS.RuleMatch — https://chromedevtools.github.io/devtools-protocol/tot/CSS/#type-RuleMatch */
export type CssRuleMatch = {
  rule?: CssRule;
  matchingSelectors?: number[];
};

/** CDP CSS.InheritedStyleEntry — https://chromedevtools.github.io/devtools-protocol/tot/CSS/#type-InheritedStyleEntry */
export type CssInheritedStyleEntry = {
  matchedCSSRules?: CssRuleMatch[];
  inlineStyle?: CssStyle;
  attributesStyle?: CssStyle;
};

/** CDP CSS.getMatchedStylesForNode — https://chromedevtools.github.io/devtools-protocol/tot/CSS/#method-getMatchedStylesForNode */
export type CssGetMatchedStylesForNodeResponse = {
  inlineStyle?: CssStyle;
  attributesStyle?: CssStyle;
  matchedCSSRules?: CssRuleMatch[];
  inherited?: CssInheritedStyleEntry[];
};

/** CDP CSS.getMediaQueries — https://chromedevtools.github.io/devtools-protocol/tot/CSS/#method-getMediaQueries */
export type CssGetMediaQueriesResponse = {
  medias?: CssMedia[];
};

/** CDP CSS.CSSStyleSheetHeader — https://chromedevtools.github.io/devtools-protocol/tot/CSS/#type-CSSStyleSheetHeader */
export type CssStyleSheetHeader = {
  styleSheetId: string;
  sourceURL?: string;
  origin?: string;
  title?: string;
  disabled?: boolean;
};

/** CDP CSS.getStyleSheet — https://chromedevtools.github.io/devtools-protocol/tot/CSS/#method-getStyleSheet */
export type CssGetStyleSheetResponse = {
  stylesheet?: CssStyleSheetHeader;
};

/** CDP CSS.styleSheetAdded — https://chromedevtools.github.io/devtools-protocol/tot/CSS/#event-styleSheetAdded */
export type CssStyleSheetAddedEvent = {
  header: CssStyleSheetHeader;
};
