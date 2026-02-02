"use client";

import { useState } from "react";
import styles from "../page.module.css";
import { CodeBlock } from "./code-block";

type Tool = "cursor" | "claude" | "antigravity";

export function McpSetup() {
  const [tool, setTool] = useState<Tool>("cursor");

  const cursorConfig = {
    mcpServers: {
      caliper: {
        command: "npx",
        args: ["-y", "@oyerinde/caliper-mcp", "--port", "9876"],
      },
    },
  };

  const antigravityConfig = {
    mcpServers: {
      caliper: {
        command: "npx",
        args: ["-y", "@oyerinde/caliper-mcp", "--port", "9876"],
      },
    },
  };

  const getCode = () => {
    switch (tool) {
      case "cursor":
        return JSON.stringify(cursorConfig, null, 2);
      case "claude":
        return `claude mcp add @oyerinde/caliper-mcp -- npx -y @oyerinde/caliper-mcp --port 9876`;
      case "antigravity":
        return JSON.stringify(antigravityConfig, null, 2);
    }
  };

  const getLanguage = () => {
    return tool === "claude" ? "bash" : "json";
  };

  return (
    <div className={styles.installContainer}>
      <div className={`${styles.tabs} flex flex-wrap gap-8`}>
        <button
          className={`${styles.tab} ${tool === "cursor" ? styles.activeTab : ""}`}
          onClick={() => setTool("cursor")}
        >
          Cursor
        </button>
        <button
          className={`${styles.tab} ${tool === "claude" ? styles.activeTab : ""}`}
          onClick={() => setTool("claude")}
        >
          Claude Code
        </button>
        <button
          className={`${styles.tab} ${tool === "antigravity" ? styles.activeTab : ""}`}
          onClick={() => setTool("antigravity")}
        >
          Antigravity
        </button>
      </div>

      <div className="">
        {tool === "cursor" && (
          <>
            <p className="mb-12 op-8">
              Add to your <code>mcp.json</code> or use the UI settings:
            </p>
            <CodeBlock code={getCode()} language={getLanguage()} />
          </>
        )}

        {tool === "claude" && (
          <>
            <p className="mb-12 op-8">Run this command in your terminal:</p>
            <CodeBlock code={getCode()} language={getLanguage()} />
          </>
        )}

        {tool === "antigravity" && (
          <>
            <p className="mb-12 op-8">
              Add to your <code>mcp_config.json</code>:
            </p>
            <CodeBlock code={getCode()} language={getLanguage()} />
          </>
        )}
      </div>
    </div>
  );
}
