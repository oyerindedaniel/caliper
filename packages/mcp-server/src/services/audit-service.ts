import type {
    FigmaDesignProps,
    BrowserElementProps,
    AuditStrategy,
    AuditResult,
    Delta,
    CSSRecommendation,
} from "@oyerinde/caliper-schema";

const DEFAULT_TOLERANCE = 1; // 1px tolerance for sub-pixel rendering differences

/**
 * Calculate a single delta between design and actual values.
 */
function createDelta(
    property: string,
    designValue: number,
    actualValue: number,
    tolerance: number
): Delta {
    const delta = actualValue - designValue;
    return {
        property,
        designValue,
        actualValue,
        delta,
        isAcceptable: Math.abs(delta) <= tolerance,
    };
}

/**
 * Strategy A: Container-First (Max Boundary)
 *
 * The Figma frame represents the maximum content width.
 * The element should be centered within the viewport.
 * At viewports wider than the frame, the element stays at frame width.
 * At viewports narrower than the frame, the element shrinks proportionally.
 */
function auditStrategyA(
    design: FigmaDesignProps,
    browser: BrowserElementProps,
    tolerance: number
): { deltas: Delta[]; recommendations: CSSRecommendation[] } {
    const deltas: Delta[] = [];
    const recommendations: CSSRecommendation[] = [];

    // Calculate expected width: min(nodeWidth, viewportWidth - expected padding)
    const expectedPadding = design.nodeX; // Left padding from Figma
    const expectedRightPadding = design.frameWidth - design.nodeX - design.nodeWidth;
    const totalExpectedPadding = expectedPadding + expectedRightPadding;

    // If viewport is wider than frame, element should match Figma exactly
    // If viewport is narrower, element should be: viewportWidth - totalPadding
    const isViewportWider = browser.viewportWidth >= design.frameWidth;

    let expectedWidth: number;
    let expectedLeft: number;

    if (isViewportWider) {
        // Element should be centered with Figma width
        expectedWidth = design.nodeWidth;
        expectedLeft = (browser.viewportWidth - design.nodeWidth) / 2;
    } else {
        // Element shrinks, padding is preserved proportionally or fixed
        const scaleFactor = browser.viewportWidth / design.frameWidth;
        expectedWidth = design.nodeWidth * scaleFactor;
        expectedLeft = expectedPadding * scaleFactor;
    }

    // Width delta
    const widthDelta = createDelta("width", expectedWidth, browser.width, tolerance);
    deltas.push(widthDelta);

    if (!widthDelta.isAcceptable) {
        if (isViewportWider) {
            recommendations.push({
                property: "max-width",
                currentValue: `${browser.width}px`,
                recommendedValue: `${design.nodeWidth}px`,
                reason: "Element should have a max-width matching the Figma design width",
            });
            recommendations.push({
                property: "margin",
                currentValue: "unknown",
                recommendedValue: "0 auto",
                reason: "Element should be horizontally centered",
            });
        } else {
            recommendations.push({
                property: "width",
                currentValue: `${browser.width}px`,
                recommendedValue: "100%",
                reason: "Element should fill available width when viewport is narrower than design",
            });
        }
    }

    // Left position delta (centering check)
    const leftDelta = createDelta("left", expectedLeft, browser.left, tolerance * 2); // Double tolerance for position
    deltas.push(leftDelta);

    if (!leftDelta.isAcceptable) {
        recommendations.push({
            property: "margin-left",
            currentValue: `${browser.left}px`,
            recommendedValue: isViewportWider ? "auto" : `${expectedPadding}px`,
            reason: isViewportWider
                ? "Element should be auto-centered"
                : "Element should preserve design left margin",
        });
    }

    return { deltas, recommendations };
}

/**
 * Strategy B: Padding-Locked (Fixed Edge Spacing)
 *
 * The padding is sacred and must be preserved.
 * Content stretches to fill the space between paddings.
 * Width is flexible, padding is fixed.
 */
function auditStrategyB(
    design: FigmaDesignProps,
    browser: BrowserElementProps,
    tolerance: number
): { deltas: Delta[]; recommendations: CSSRecommendation[] } {
    const deltas: Delta[] = [];
    const recommendations: CSSRecommendation[] = [];

    const designLeftPadding = design.paddingLeft ?? design.nodeX;
    const designRightPadding = design.paddingRight ?? (design.frameWidth - design.nodeX - design.nodeWidth);

    const expectedWidth = browser.viewportWidth - designLeftPadding - designRightPadding;

    const widthDelta = createDelta("width", expectedWidth, browser.width, tolerance);
    deltas.push(widthDelta);

    if (!widthDelta.isAcceptable) {
        recommendations.push({
            property: "width",
            currentValue: `${browser.width}px`,
            recommendedValue: "100%",
            reason: "Element should stretch to fill space between fixed paddings",
        });
        recommendations.push({
            property: "box-sizing",
            currentValue: "unknown",
            recommendedValue: "border-box",
            reason: "Ensure padding is included in width calculation",
        });
    }

    const actualLeftPadding = browser.paddingLeft ?? browser.left;
    const leftPaddingDelta = createDelta("padding-left", designLeftPadding, actualLeftPadding, tolerance);
    deltas.push(leftPaddingDelta);

    if (!leftPaddingDelta.isAcceptable) {
        recommendations.push({
            property: "padding-left",
            currentValue: `${actualLeftPadding}px`,
            recommendedValue: `${designLeftPadding}px`,
            reason: "Left padding must match design exactly (Strategy B: padding is sacred)",
        });
    }

    const actualRightPadding = browser.paddingRight ?? (browser.viewportWidth - browser.left - browser.width);
    const rightPaddingDelta = createDelta("padding-right", designRightPadding, actualRightPadding, tolerance);
    deltas.push(rightPaddingDelta);

    if (!rightPaddingDelta.isAcceptable) {
        recommendations.push({
            property: "padding-right",
            currentValue: `${actualRightPadding}px`,
            recommendedValue: `${designRightPadding}px`,
            reason: "Right padding must match design exactly (Strategy B: padding is sacred)",
        });
    }

    return { deltas, recommendations };
}

/**
 * Strategy C: Ratio-Based (Proportional Width)
 *
 * The element maintains the same proportion to the viewport as in Figma.
 * Width is expressed as a percentage of the viewport.
 */
function auditStrategyC(
    design: FigmaDesignProps,
    browser: BrowserElementProps,
    tolerance: number
): { deltas: Delta[]; recommendations: CSSRecommendation[] } {
    const deltas: Delta[] = [];
    const recommendations: CSSRecommendation[] = [];

    const designRatio = design.nodeWidth / design.frameWidth;
    const designRatioPercent = Math.round(designRatio * 1000) / 10; // e.g., 92.8%

    const expectedWidth = browser.viewportWidth * designRatio;

    const actualRatio = browser.width / browser.viewportWidth;
    const actualRatioPercent = Math.round(actualRatio * 1000) / 10;

    const ratioDelta = (actualRatio - designRatio) * browser.viewportWidth;
    const widthDelta = createDelta("width", expectedWidth, browser.width, tolerance);
    deltas.push(widthDelta);

    deltas.push({
        property: "width-ratio",
        designValue: designRatioPercent,
        actualValue: actualRatioPercent,
        delta: actualRatioPercent - designRatioPercent,
        isAcceptable: Math.abs(ratioDelta) <= tolerance,
    });

    if (!widthDelta.isAcceptable) {
        recommendations.push({
            property: "width",
            currentValue: `${browser.width}px (${actualRatioPercent}%)`,
            recommendedValue: `${designRatioPercent}%`,
            reason: `Element should always occupy ${designRatioPercent}% of the viewport (Strategy C: proportional)`,
        });

        recommendations.push({
            property: "max-width",
            currentValue: "none",
            recommendedValue: `${design.nodeWidth}px`,
            reason: "Cap element at design width to prevent over-scaling on wide viewports",
        });
    }

    const expectedLeft = (browser.viewportWidth - expectedWidth) / 2;
    const leftDelta = createDelta("left", expectedLeft, browser.left, tolerance * 2);
    deltas.push(leftDelta);

    if (!leftDelta.isAcceptable) {
        recommendations.push({
            property: "margin",
            currentValue: `0 ${browser.marginLeft ?? 0}px`,
            recommendedValue: "0 auto",
            reason: "Element should be horizontally centered",
        });
    }

    return { deltas, recommendations };
}

/**
 * Main audit function that dispatches to the appropriate strategy.
 */
export function auditDesignVsBrowser(
    design: FigmaDesignProps,
    browser: BrowserElementProps,
    strategy: AuditStrategy,
    tolerance: number = DEFAULT_TOLERANCE
): AuditResult {
    let strategyResult: { deltas: Delta[]; recommendations: CSSRecommendation[] };

    switch (strategy) {
        case "A":
            strategyResult = auditStrategyA(design, browser, tolerance);
            break;
        case "B":
            strategyResult = auditStrategyB(design, browser, tolerance);
            break;
        case "C":
            strategyResult = auditStrategyC(design, browser, tolerance);
            break;
    }

    const { deltas, recommendations } = strategyResult;
    const isPixelPerfect = deltas.every((d) => d.isAcceptable);

    let summary: string;
    if (isPixelPerfect) {
        summary = `✅ Pixel Perfect! The implementation matches the Figma design within ${tolerance}px tolerance using Strategy ${strategy}.`;
    } else {
        const issueCount = deltas.filter((d) => !d.isAcceptable).length;
        const issues = deltas
            .filter((d) => !d.isAcceptable)
            .map((d) => `${d.property}: ${d.delta > 0 ? "+" : ""}${d.delta.toFixed(1)}px`)
            .join(", ");
        summary = `⚠️ ${issueCount} issue(s) detected. Deltas: ${issues}. Review recommendations below.`;
    }

    return {
        isPixelPerfect,
        strategy,
        summary,
        deltas,
        recommendations,
        viewportContext: {
            viewportWidth: browser.viewportWidth,
            figmaFrameWidth: design.frameWidth,
            scaleFactor: browser.viewportWidth / design.frameWidth,
        },
        timestamp: Date.now(),
    };
}
