"use client";

import { useRef } from "react";

export function ParentSiblingTest() {
  const containerRef = useRef<HTMLDivElement>(null);

  return (
    <div
      ref={containerRef}
      style={{
        padding: "40px",
        minHeight: "400px",
        border: "2px dashed #ccc",
        borderRadius: "8px",
        margin: "20px 0",
      }}
    >
      <h2 style={{ marginBottom: "20px" }}>Parent vs Sibling Detection</h2>
      <p style={{ marginBottom: "30px", color: "#666" }}>
        Hold ALT and move cursor to test parent/sibling detection. Case A: Cursor in sibling shows
        one distance line. Case B: Cursor in parent shows four padding lines.
      </p>

      {/* Parent container */}
      <div
        style={{
          position: "relative",
          width: "100%",
          minHeight: "300px",
          padding: "30px",
          backgroundColor: "#f0f0f0",
          border: "2px solid #3b82f6",
          borderRadius: "8px",
        }}
        data-testid="parent-container"
      >
        <p style={{ marginBottom: "20px", fontSize: "14px", color: "#666" }}>
          Parent Container (hover here to see padding measurements)
        </p>

        {/* Sibling 1 */}
        <div
          style={{
            display: "inline-block",
            width: "150px",
            height: "100px",
            backgroundColor: "#60a5fa",
            margin: "10px",
            padding: "20px",
            borderRadius: "4px",
            border: "2px solid #2563eb",
          }}
          data-testid="sibling-1"
        >
          <div
            style={{
              width: "100%",
              height: "100%",
              backgroundColor: "#93c5fd",
              borderRadius: "4px",
            }}
            data-testid="child-of-sibling-1"
          >
            Sibling 1 (hover to see sibling distance)
          </div>
        </div>

        {/* Sibling 2 */}
        <div
          style={{
            display: "inline-block",
            width: "150px",
            height: "100px",
            backgroundColor: "#34d399",
            margin: "10px",
            padding: "20px",
            borderRadius: "4px",
            border: "2px solid #059669",
          }}
          data-testid="sibling-2"
        >
          <div
            style={{
              width: "100%",
              height: "100%",
              backgroundColor: "#6ee7b7",
              borderRadius: "4px",
            }}
            data-testid="child-of-sibling-2"
          >
            Sibling 2 (hover to see sibling distance)
          </div>
        </div>

        {/* Sibling 3 */}
        <div
          style={{
            display: "inline-block",
            width: "150px",
            height: "100px",
            backgroundColor: "#fbbf24",
            margin: "10px",
            padding: "20px",
            borderRadius: "4px",
            border: "2px solid #d97706",
          }}
          data-testid="sibling-3"
        >
          <div
            style={{
              width: "100%",
              height: "100%",
              backgroundColor: "#fcd34d",
              borderRadius: "4px",
            }}
            data-testid="child-of-sibling-3"
          >
            Sibling 3 (hover to see sibling distance)
          </div>
        </div>
      </div>

      <div style={{ marginTop: "20px", fontSize: "12px", color: "#999" }}>
        <strong>Instructions:</strong>
        <ul style={{ marginTop: "10px", paddingLeft: "20px" }}>
          <li>Hold ALT key to activate measurement mode</li>
          <li>Click on any colored box to select it</li>
          <li>Move cursor over sibling boxes to see distance measurements</li>
          <li>Move cursor over parent container (gray area) to see padding measurements</li>
          <li>Move cursor over child elements to see child measurements</li>
        </ul>
      </div>
    </div>
  );
}
