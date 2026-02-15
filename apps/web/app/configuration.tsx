import { useState } from "react";
import styles from "@/app/page.module.css";
import { useOS } from "./hooks/use-os";
import { CodeBlock } from "./components/code-block";

type ConfigSection = "overview" | "theme" | "commands" | "animation" | "bridge";

interface ConfigurationProps {
  sections?: ConfigSection[];
  initialSection?: ConfigSection;
  showHeader?: boolean;
}

export function Configuration({
  sections = ["overview", "theme", "commands", "animation", "bridge"],
  initialSection,
  showHeader = true,
}: ConfigurationProps) {
  const [section, setSection] = useState<ConfigSection>(initialSection ?? sections[0]!);
  const { getSelectKey } = useOS();

  const overviewCode = `export interface CaliperConfig {
  theme?: ThemeConfig;          // Visual appearance (colors, shadows)
  commands?: CommandsConfig;    // Keyboard shortcuts
  animation?: AnimationConfig;  // Boundary box lerp behavior
  debug?: boolean;              // Enable debug logging (default: true). All logs are stripped in production.
}`;

  const bridgeCode = `export interface AgentBridgeConfig {
  enabled?: boolean;    // Toggle bridge (default: false)
  wsPort?: number;     // WebSocket port (default: 9876)
  onStateChange?: (state: CaliperAgentState) => void; // State callback (ESM)
  onStateChangeGlobal?: string; // Global function name (IIFE/CDN)
}`;

  const themeCode = `export interface ThemeConfig {
  primary?: string;         // Primary action color
  secondary?: string;       // Secondary highlight color
  calcBg?: string;          // Calculator background
  calcShadow?: string;      // UI shadow color
  calcOpHighlight?: string; // Active side highlight
  calcText?: string;        // Text color inside UI
  projection?: string;      // Projection line color
  ruler?: string;           // Viewport ruler color
}`;

  const commandsCode = `export interface CommandsConfig {
  activate?: string;   // Toggle measuring (default: Alt)
  freeze?: string;     // Freeze current lines (default: Space)
  select?: string;     // Deep select element (default: Hold + ${getSelectKey()})
  clear?: string;      // Wipe all overlays (default: Escape)
  ruler?: string;      // Add viewport ruler (default: r)
  selectionHoldDuration?: number; // Selection hold time (default: 250)
  
  calculator?: {
    top?: string;      // Measure from top edge (default: t)
    right?: string;    // Measure from right edge (default: r)
    bottom?: string;   // Measure from bottom edge (default: b)
    left?: string;     // Measure from left edge (default: l)
    distance?: string; // Measure side-to-side (default: g)
  };
  
  projection?: {
    top?: string;    // Project upwards (default: w)
    right?: string;  // Project right (default: d)
    bottom?: string; // Project downwards (default: s)
    left?: string;   // Project left (default: a)
  };
}`;

  const animationCode = `export interface AnimationConfig {
  enabled?: boolean;    // Toggle smooth lerp (default: true)
  lerpFactor?: number;  // Smoothness 0-1 (default: 0.25)
}`;

  const getCode = () => {
    switch (section) {
      case "theme":
        return themeCode;
      case "commands":
        return commandsCode;
      case "animation":
        return animationCode;
      case "bridge":
        return bridgeCode;
      default:
        return overviewCode;
    }
  };

  return (
    <section id="configuration" className={styles.section}>
      {showHeader && <h2 className={styles.sectionHeader}>Configuration</h2>}
      <div className={`${styles.tabs} flex flex-wrap gap-8`}>
        {sections.map((s) => (
          <button
            key={s}
            className={`${styles.tab} ${section === s ? styles.activeTab : ""}`}
            onClick={() => setSection(s)}
          >
            {s.charAt(0).toUpperCase() + s.slice(1)}
          </button>
        ))}
      </div>

      <CodeBlock code={getCode()} language="typescript" />
    </section>
  );
}
