import type {
    CaliperNode,
    SemanticNode,
    DesignTokenDictionary,
    Framework,
    ContextMetrics,
} from "@oyerinde/caliper-schema";

type PropertyCategory = "colors" | "spacing" | "typography" | "borderRadius" | "layout";
type ValueType = "color" | "length" | "keyword" | "number" | "hybrid";

export interface PropertyConfig {
    category: PropertyCategory;
    valueType: ValueType;
}

export interface ReconciliationInput {
    caliperTree: CaliperNode;
    expectedHtml: string;
    designTokens: DesignTokenDictionary;
    framework: Framework;
    figmaLayerUrl: string;
    metrics?: ContextMetrics;
    secondaryHtml?: string;
    secondaryTokens?: DesignTokenDictionary;
}

// TODO: infer this id from computerstyes 
export interface PropertyDefinition {
    id: string;
    inferredKey: keyof NonNullable<SemanticNode["inferredStyles"]>;
    actualValue: (node: CaliperNode, parentWidth: number, parentHeight: number) => string | null;
    percentageBasis?: (parentWidth: number, parentHeight: number, node: CaliperNode) => number;
    category: PropertyCategory
}
