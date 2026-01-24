"use client";

import styles from "../../page.module.css";
import { DocPageLayout, DocHeader, DocSection } from "../../components/docs-layout";
import { CodeBlock } from "../../components/code-block";

export default function AgenticDocsPage() {
    const bridgeInstallCode = `npm install @oyerinde/caliper-bridge`;

    const bridgeInitCode = `import { init } from "@oyerinde/caliper";
import { initAgentBridge } from "@oyerinde/caliper-bridge";

const caliper = init();

// Wait for systems to be ready before initializing the bridge
caliper.waitForSystems().then((systems) => {
  initAgentBridge({
    enabled: true,
    systems
  });
});`;

    const mcpInstallCode = `npx -y @oyerinde/caliper-mcp --port 9876`;

    return (
        <DocPageLayout>
            <DocHeader
                title="Agentic Implementation"
                description="Connect your browser to AI agents for high-precision design auditing and automated layout verification."
            />

            <DocSection title="Agent Bridge">
                <p style={{ marginBottom: "24px", opacity: 0.8 }}>
                    The Bridge is a thin client-side layer that exposes your app's layout state to external agents via WebSockets.
                </p>

                <h3 className={styles.subHeader}>Installation</h3>
                <CodeBlock code={bridgeInstallCode} language="bash" />

                <h3 className={styles.subHeader} style={{ marginTop: "32px" }}>Initialization</h3>
                <p style={{ marginBottom: "16px", opacity: 0.8 }}>
                    Add this to your root layout or entry point. By default, the bridge is inactive unless `enabled: true` is passed.
                </p>
                <CodeBlock code={bridgeInitCode} language="tsx" />
            </DocSection>

            <DocSection title="MCP Server">
                <p style={{ marginBottom: "24px", opacity: 0.8 }}>
                    The Model Context Protocol (MCP) server provides high-level tools and guided prompts to agents like Cursor and Claude.
                </p>

                <h3 className={styles.subHeader}>Quick Start</h3>
                <CodeBlock code={mcpInstallCode} language="bash" />

                <h3 className={styles.subHeader} style={{ marginTop: "32px" }}>Setup in Cursor</h3>
                <ol className={styles.instructionList} style={{ marginTop: "16px", marginBottom: "16px" }}>
                    <li className={styles.instructionItem}>1. Open <strong>Settings</strong> &gt; <strong>Features</strong> &gt; <strong>MCP</strong>.</li>
                    <li className={styles.instructionItem}>2. Click <strong>+ Add New MCP Server</strong>.</li>
                    <li className={styles.instructionItem}>3. Type: <code>command</code>. Name: <code>Caliper</code>.</li>
                    <li className={styles.instructionItem}>4. Command: <code>npx -y @oyerinde/caliper-mcp --port 9876</code></li>
                </ol>
            </DocSection>

            <DocSection title="Audit Workflow">
                <div className={styles.trySection} style={{ background: "rgba(24, 160, 251, 0.03)", borderColor: "rgba(24, 160, 251, 0.2)" }}>
                    <div className={styles.tryBadge} style={{ color: "#18a0fb" }}>Closed-Loop Auditing</div>
                    <p style={{ marginTop: "12px", fontSize: "14px", opacity: 0.9 }}>
                        Combine Caliper with the <strong>Official Figma MCP</strong> for sub-pixel design reconciliation.
                    </p>

                    <div style={{ display: "flex", flexDirection: "column", gap: "24px", marginTop: "24px" }}>
                        <div className={styles.configControl}>
                            <h4 className={styles.subHeader} style={{ marginTop: 0 }}>Strategy A</h4>
                            <p style={{ fontSize: "13px", opacity: 0.7 }}><strong>Container-First</strong> — Matches centered layouts with max-widths.</p>
                        </div>
                        <div className={styles.configControl}>
                            <h4 className={styles.subHeader} style={{ marginTop: 0 }}>Strategy B</h4>
                            <p style={{ fontSize: "13px", opacity: 0.7 }}><strong>Padding-Locked</strong> — Preserves absolute edge spacing.</p>
                        </div>
                        <div className={styles.configControl}>
                            <h4 className={styles.subHeader} style={{ marginTop: 0 }}>Strategy C</h4>
                            <p style={{ fontSize: "13px", opacity: 0.7 }}><strong>Ratio-Based</strong> — Proportional width scaling.</p>
                        </div>
                    </div>
                </div>
            </DocSection>

            <DocSection title="Expert Prompts">
                <p style={{ marginBottom: "24px", opacity: 0.8 }}>Pre-defined playbooks to guide AI agents through complex spatial tasks:</p>
                <div className={styles.tableContainer}>
                    <table className={styles.commandTable}>
                        <thead>
                            <tr>
                                <th>Prompt</th>
                                <th>Description</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr>
                                <td><code>caliper-figma-audit</code></td>
                                <td>Pixel-perfect design reconciliation workflow.</td>
                            </tr>
                            <tr>
                                <td><code>caliper-spacing-check</code></td>
                                <td>Mathematical consistency check for grids/lists.</td>
                            </tr>
                            <tr>
                                <td><code>caliper-audit-harness</code></td>
                                <td>Mandatory context-gathering loop to ensure stable code edits.</td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </DocSection>
        </DocPageLayout>
    );
}
