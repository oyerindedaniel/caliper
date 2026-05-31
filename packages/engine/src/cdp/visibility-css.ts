import {
  CALIPER_VISIBILITY_REASON,
  CALIPER_VISIBILITY_STATUS,
  type CaliperVisibility,
  type CaliperVisibilityHiddenBy,
} from "@oyerinde/caliper-schema";
import type { CdpClient } from "./cdp-client.js";
import { resolveSelectorToNodeId } from "./dom-resolver.js";

type CssStyleProperty = {
  name: string;
  value: string;
};

type CssStyle = {
  cssProperties?: CssStyleProperty[];
  shorthandEntries?: Array<{ name: string; value: string }>;
};

type CssRule = {
  selectorList?: { text?: string };
  style?: CssStyle;
  media?: Array<{ text?: string; source?: string }>;
  styleSheetId?: string;
};

type RuleMatch = {
  rule?: CssRule;
};

type MatchedStylesResponse = {
  matchedCSSRules?: RuleMatch[];
  inherited?: Array<{ matchedCSSRules?: RuleMatch[] }>;
};

type StylesheetHeader = {
  styleSheetId: string;
  sourceURL?: string;
};

export class CssVisibilitySession {
  private stylesheetUrls = new Map<string, string>();

  constructor(private readonly client: CdpClient) {}

  async enable(): Promise<void> {
    await this.client.send("CSS.enable");
    this.client.onEvent("CSS.styleSheetAdded", (params) => {
      const header = params as StylesheetHeader;
      if (header.styleSheetId) {
        this.stylesheetUrls.set(header.styleSheetId, header.sourceURL ?? "");
      }
    });
  }

  async resolveInspectVisibility(
    selector: string,
    baseVisibility: CaliperVisibility
  ): Promise<CaliperVisibility> {
    const nodeId = await resolveSelectorToNodeId(this.client, selector);
    if (!nodeId) {
      return baseVisibility;
    }

    const matchedStyles = await this.client.send<MatchedStylesResponse>(
      "CSS.getMatchedStylesForNode",
      { nodeId }
    );

    const hiddenBy = await findDisplayNoneRule(matchedStyles, (styleSheetId) =>
      this.resolveStylesheetUrl(styleSheetId)
    );
    if (!hiddenBy) {
      return baseVisibility;
    }

    return {
      ...baseVisibility,
      status: CALIPER_VISIBILITY_STATUS.HIDDEN,
      reason: CALIPER_VISIBILITY_REASON.DISPLAY_NONE,
      hiddenBy,
      intersectingViewport: false,
    };
  }

  async listMediaQueries(): Promise<Array<{ text: string; source?: string }>> {
    const response = await this.client.send<{ medias?: Array<{ text?: string; source?: string }> }>(
      "CSS.getMediaQueries"
    );

    const queries: Array<{ text: string; source?: string }> = [];
    for (const media of response.medias ?? []) {
      if (media.text) {
        queries.push({ text: media.text, source: media.source });
      }
    }
    return queries;
  }

  private async resolveStylesheetUrl(styleSheetId: string): Promise<string | undefined> {
    if (this.stylesheetUrls.has(styleSheetId)) {
      const cached = this.stylesheetUrls.get(styleSheetId);
      return cached ? cached : undefined;
    }

    try {
      const response = await this.client.send<{ stylesheet?: { sourceURL?: string } }>(
        "CSS.getStyleSheet",
        { styleSheetId }
      );
      const sourceUrl = response.stylesheet?.sourceURL ?? "";
      this.stylesheetUrls.set(styleSheetId, sourceUrl);
      return sourceUrl || undefined;
    } catch {
      return undefined;
    }
  }
}

async function findDisplayNoneRule(
  matchedStyles: MatchedStylesResponse,
  resolveStylesheetUrl: (styleSheetId: string) => Promise<string | undefined>
): Promise<CaliperVisibilityHiddenBy | null> {
  const ruleMatches = collectRuleMatches(matchedStyles);

  for (const match of ruleMatches) {
    const rule = match.rule;
    if (!rule || !ruleHasDisplayNone(rule.style)) {
      continue;
    }

    const selectorText = rule.selectorList?.text ?? "unknown selector";
    const ruleText = `${selectorText} { display: none }`;
    const mediaQuery = rule.media?.[0]?.text;
    const stylesheetUrl = rule.styleSheetId
      ? await resolveStylesheetUrl(rule.styleSheetId)
      : undefined;

    if (mediaQuery) {
      return {
        type: "css_media_query",
        rule: ruleText,
        mediaQuery,
        stylesheetUrl,
        detail: `Element matches ${mediaQuery} { display: none } via ${selectorText}`,
      };
    }

    return {
      type: "css_rule",
      rule: ruleText,
      stylesheetUrl,
      detail: `Element matches ${ruleText}`,
    };
  }

  return null;
}

function collectRuleMatches(matchedStyles: MatchedStylesResponse): RuleMatch[] {
  const matches: RuleMatch[] = [];
  matches.push(...(matchedStyles.matchedCSSRules ?? []));
  for (const inherited of matchedStyles.inherited ?? []) {
    matches.push(...(inherited.matchedCSSRules ?? []));
  }
  return matches;
}

function ruleHasDisplayNone(style: CssStyle | undefined): boolean {
  if (!style) {
    return false;
  }

  for (const property of style.cssProperties ?? []) {
    if (property.name === "display" && property.value === "none") {
      return true;
    }
  }

  for (const shorthand of style.shorthandEntries ?? []) {
    if (shorthand.name === "display" && shorthand.value === "none") {
      return true;
    }
  }

  return false;
}
