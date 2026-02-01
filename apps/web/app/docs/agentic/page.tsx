"use client";

import styles from "../../page.module.css";
import Image from "next/image";
import { Nav } from "../../components/nav";
import { Footer } from "../../footer";
import { Installation } from "../../installation";
import { CodeBlock } from "../../components/code-block";

export default function AgenticDocsPage() {
    const mcpInstallCode = `npx @oyerinde/caliper-mcp --port 9876`;

    return (
        <div className={styles.page}>
            <main className={styles.main}>
                <Nav />

                <div className="mb-32">
                    <Image
                        src="/caliper_logo.svg"
                        alt="Caliper logo"
                        width={172}
                        height={50}
                        className="h-auto"
                        priority
                        unoptimized
                    />
                </div>

                <div>
                    <h1 className={styles.pageTitle}>Agentic</h1>
                    <p className="op-8">Connect your browser to AI agents for high-precision design auditing and automated layout verification.</p>
                </div>

                <Installation mode="agentic" />

                <section className={styles.section}>
                    <h2 className={styles.sectionHeader}>MCP Server</h2>
                    <p className="mb-18 op-8">
                        The Model Context Protocol (MCP) server acts as a relay between your browser (the Bridge) and agentic IDEs like <strong>Cursor</strong> or <strong>Claude Desktop</strong>.
                    </p>

                    <h3 className={styles.subHeader}>Quick Start</h3>
                    <p className="mb-18 op-8">
                        Run the MCP server locally. It will start a WebSocket server that the Bridge connects to, and a Stdio transport for the agent.
                    </p>
                    <CodeBlock code={mcpInstallCode} language="bash" />

                    <h3 className={styles.subHeader}>Setup in Cursor</h3>
                    <ol className={styles.instructionList}>
                        <li className={styles.instructionItem}>1. Open <strong>Settings</strong> &gt; <strong>Features</strong> &gt; <strong>MCP</strong>.</li>
                        <li className={styles.instructionItem}>2. Click <strong>+ Add New MCP Server</strong>.</li>
                        <li className={styles.instructionItem}>3. Type: <code>command</code>. Name: <code>Caliper</code>.</li>
                        <li className={styles.instructionItem}>4. Command: <code>npx @oyerinde/caliper-mcp --port 9876</code></li>
                    </ol>
                </section>

                <section className={styles.section}>
                    <h2 className={styles.sectionHeader}>Core Tools</h2>
                    <p className="mb-18 op-8">The MCP server exposes these tools to agents for interactive auditing:</p>
                    <div className={styles.tableContainer}>
                        <table className={styles.commandTable}>
                            <thead>
                                <tr>
                                    <th>Tool</th>
                                    <th>Function</th>
                                </tr>
                            </thead>
                            <tbody>
                                <tr>
                                    <td><code>caliper_list_tabs</code></td>
                                    <td>List all browser tabs currently connected to the bridge.</td>
                                </tr>
                                <tr>
                                    <td><code>caliper_switch_tab</code></td>
                                    <td>Switch targeting to a specific browser tab.</td>
                                </tr>
                                <tr>
                                    <td><code>caliper_inspect</code></td>
                                    <td>Full geometry, z-index, and computed visibility of an element.</td>
                                </tr>
                                <tr>
                                    <td><code>caliper_measure</code></td>
                                    <td>High-precision distance calculation between two elements.</td>
                                </tr>
                                <tr>
                                    <td><code>caliper_walk_dom</code></td>
                                    <td>Inspect the DOM hierarchy (parents/children) of a specific element.</td>
                                </tr>
                                <tr>
                                    <td><code>caliper_walk_and_measure</code></td>
                                    <td>Recursive BFS walk with computed styles and neighbor gaps.</td>
                                </tr>
                                <tr>
                                    <td><code>caliper_get_context</code></td>
                                    <td>Comprehensive window, viewport, and accessibility metrics.</td>
                                </tr>
                                <tr>
                                    <td><code>caliper_parse_selector</code></td>
                                    <td>Parse rich selector data copied from the Caliper UI.</td>
                                </tr>
                                <tr>
                                    <td><code>caliper_check_contrast</code></td>
                                    <td>WCAG 2.1 contrast ratio check between foreground and background.</td>
                                </tr>
                                <tr>
                                    <td><code>caliper_delta_e</code></td>
                                    <td>Perceptual color difference check between two colors.</td>
                                </tr>
                                <tr>
                                    <td><code>caliper_clear</code></td>
                                    <td>Reset all active measurements and guides in the UI.</td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                </section>

                <section className={styles.section}>
                    <h2 className={styles.sectionHeader}>Agent Prompts</h2>
                    <p className="mb-18 op-8">Built-in playbooks that guide agents through complex design reconciliation tasks:</p>
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
                                    <td><code>caliper-selector-audit</code></td>
                                    <td>A phase-based workflow from source discovery to precision styling fix.</td>
                                </tr>
                                <tr>
                                    <td><code>caliper-selectors-compare</code></td>
                                    <td>Compare a "reference" element with a "target" to debug inconsistencies.</td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                </section>
            </main>
            <Footer />
        </div>
    );
}
