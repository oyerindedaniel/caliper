"use client";

import styles from "@/app/page.module.css";
import Image from "next/image";
import { Installation } from "@/app/installation";
import { McpSetup } from "@/app/components/mcp-setup";
import { CodeBlock } from "@/app/components/code-block";
import { Configuration } from "@/app/configuration";

export default function AgenticDocsPage() {
    return (
        <>
            <div className="flex flex-col gap-12">
                <div className={styles.logoWrapper}>
                    <Image
                        src="/caliper_logo.svg"
                        alt="Caliper logo"
                        width={172}
                        height={50}
                        className="h-auto"
                        priority
                        unoptimized
                    />
                    <span className={styles.agentBadge}>Agent</span>
                </div>

                <div>
                    <h1 className="sr-only">Agentic</h1>
                    <p className="op-8">
                        Connect your browser to AI agents for high-precision design auditing and automated
                        layout verification.
                    </p>
                </div>
            </div>

            <Installation mode="agentic" />

            <Configuration sections={["bridge"]} showHeader={true} />

            <section id="how-to-use" className={styles.section}>
                <h2 className={styles.sectionHeader}>How to Use</h2>

                <h3 className={styles.subHeader}>Step 1: Setup Bridge</h3>
                <p className="mb-12 op-8">
                    Complete the <a href="#installation">Installation</a> section to inject the Caliper Bridge
                    into your local development environment.
                </p>

                <h3 className={styles.subHeader}>Step 2: Connect Agent</h3>
                <p className="mb-12 op-8">
                    Configure the <a href="#mcp-server">MCP Server</a> in your AI agent's settings. Once
                    connected, the agent will have passive visibility into your active tab.
                </p>

                <h3 className={styles.subHeader}>Step 3: Handoff Selection</h3>
                <p className="mb-12 op-8">
                    Use the Caliper UI to select an element, then use shortcuts to copy its metadata and paste
                    it directly into your IDE or TUI chat:
                </p>
                <ul className={styles.instructionList}>
                    <li className={styles.instructionItem}>
                        <strong>Right-Click Selection</strong> — Copy the full JSON Fingerprint for a stable
                        agent handoff.
                    </li>
                    <li className={styles.instructionItem}>
                        <strong>Shift + Right-Click</strong> — Copy the specific{" "}
                        <code>data-caliper-agent-id</code> to target a single element.
                    </li>
                </ul>
            </section>

            <section id="stable-selectors" className={styles.section}>
                <h2 className={styles.sectionHeader}>Stable Selectors</h2>
                <p className="mb-18 op-8">
                    AI agents often need to rediscover elements after triggering code changes. While Caliper
                    uses coordinate hit-testing as a fallback, you can ensure 100% reliability by adding
                    stable markers to mission-critical components:
                </p>

                <CodeBlock code={`<div {...caliperProps("main-cta")}>Click Me</div>`} language="tsx" />
            </section>

            <section id="mcp-server" className={styles.section}>
                <h2 className={styles.sectionHeader}>MCP Server</h2>
                <p className="mb-18 op-8">
                    The Model Context Protocol (MCP) server acts as a relay between your browser (the Bridge)
                    and agentic IDEs like <strong>Cursor</strong>, <strong>Claude Code</strong>, or{" "}
                    <strong>Antigravity</strong>.
                </p>

                <h3 className={styles.subHeader}>Setup</h3>
                <McpSetup />
            </section>

            <section id="core-tools" className={styles.section}>
                <h2 className={styles.sectionHeader}>Core Tools</h2>
                <p className="mb-18 op-8">
                    The MCP server exposes these tools to agents for interactive auditing:
                </p>
                <div className={styles.tableContainer}>
                    <table className={`${styles.commandTable} ${styles.mobileStack}`}>
                        <thead>
                            <tr>
                                <th>Tool</th>
                                <th>Function</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr>
                                <td>
                                    <code>caliper_list_tabs</code>
                                </td>
                                <td>List all browser tabs currently connected to the bridge.</td>
                            </tr>
                            <tr>
                                <td>
                                    <code>caliper_switch_tab</code>
                                </td>
                                <td>Switch targeting to a specific browser tab.</td>
                            </tr>
                            <tr>
                                <td>
                                    <code>caliper_inspect</code>
                                </td>
                                <td>Full geometry, z-index, and computed visibility of an element.</td>
                            </tr>
                            <tr>
                                <td>
                                    <code>caliper_measure</code>
                                </td>
                                <td>High-precision distance calculation between two elements.</td>
                            </tr>
                            <tr>
                                <td>
                                    <code>caliper_walk_dom</code>
                                </td>
                                <td>Inspect the DOM hierarchy (parents/children) of a specific element.</td>
                            </tr>
                            <tr>
                                <td>
                                    <code>caliper_walk_and_measure</code>
                                </td>
                                <td>Capture precise measurements and styles for a component and its children.</td>
                            </tr>
                            <tr>
                                <td>
                                    <code>caliper_get_context</code>
                                </td>
                                <td>Comprehensive window, viewport, and accessibility metrics.</td>
                            </tr>
                            <tr>
                                <td>
                                    <code>caliper_check_contrast</code>
                                </td>
                                <td>WCAG 2.1 contrast ratio check between foreground and background.</td>
                            </tr>
                            <tr>
                                <td>
                                    <code>caliper_delta_e</code>
                                </td>
                                <td>Perceptual color difference check between two colors.</td>
                            </tr>
                            <tr>
                                <td>
                                    <code>caliper_clear</code>
                                </td>
                                <td>Reset all active measurements and guides in the UI.</td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </section>

            <section id="resources" className={styles.section}>
                <h2 className={styles.sectionHeader}>Resources</h2>
                <p className="mb-18 op-8">
                    Agents can subscribe to these resources for real-time state observation:
                </p>
                <div className={styles.tableContainer}>
                    <table className={`${styles.commandTable} ${styles.mobileStack}`}>
                        <thead>
                            <tr>
                                <th>Resource</th>
                                <th>Description</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr>
                                <td>
                                    <code>caliper://tabs</code>
                                </td>
                                <td>Live list of all connected browser windows/tabs.</td>
                            </tr>
                            <tr>
                                <td>
                                    <code>caliper://state</code>
                                </td>
                                <td>
                                    Real-time passive observation of the active tab. Includes selection metadata,
                                    measurement results, and stable <strong>JSON Fingerprints</strong> that allow
                                    agents to immediately "hand-off" manual focus to inspection tools (like{" "}
                                    <code>caliper_inspect</code>).
                                </td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </section>

            <section id="agent-prompts" className={styles.section}>
                <h2 className={styles.sectionHeader}>Agent Prompts</h2>
                <p className="mb-18 op-8">
                    Built-in playbooks that guide agents through complex design reconciliation tasks:
                </p>
                <div className={styles.tableContainer}>
                    <table className={`${styles.commandTable} ${styles.mobileStack}`}>
                        <thead>
                            <tr>
                                <th>Prompt</th>
                                <th>Description</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr>
                                <td>
                                    <code>caliper-selector-audit</code>
                                </td>
                                <td>A phase-based workflow from source discovery to precision styling fix.</td>
                            </tr>
                            <tr>
                                <td>
                                    <code>caliper-selectors-compare</code>
                                </td>
                                <td>Compare a "reference" element with a "target" to debug inconsistencies.</td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </section>
        </>
    );
}
