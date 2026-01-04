import type { JSX } from "solid-js";

/**
 * Icon Components for the Calculator
 * These ensure symbols like * and + are perfectly aligned regardless of font
 */

const iconStyle = {
    width: "12px",
    height: "12px",
    "stroke-width": "2.5",
    stroke: "currentColor",
    fill: "none",
    "stroke-linecap": "round" as const,
    "stroke-linejoin": "round" as const,
    display: "block"
};

export const Icons = {
    "+": (): JSX.Element => (
        <svg viewBox="0 0 24 24" style={iconStyle}>
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
    ),
    "-": (): JSX.Element => (
        <svg viewBox="0 0 24 24" style={iconStyle}>
            <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
    ),
    "*": (): JSX.Element => (
        <svg viewBox="0 0 24 24" style={iconStyle}>
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
    ),
    "/": (): JSX.Element => (
        <svg viewBox="0 0 24 24" style={iconStyle}>
            <line x1="19" y1="5" x2="5" y2="19" />
        </svg>
    ),
};
