"use client";

import { useRef } from "react";

export function EdgeOverlapsTest() {
  return (
    <div
      style={{
        padding: "40px",
        minHeight: "500px",
        border: "2px dashed #ccc",
        borderRadius: "8px",
        margin: "20px 0",
      }}
    >
      <h2 style={{ marginBottom: "20px" }}>Edge Overlaps & Cursor Intent Priority</h2>
      <p style={{ marginBottom: "30px", color: "#666" }}>
        Test cursor intent priority when elements overlap at edges. The tool should prioritize the
        closest enclosing meaningful box.
      </p>

      {/* Overlapping siblings */}
      <div
        style={{
          position: "relative",
          width: "100%",
          minHeight: "400px",
          padding: "30px",
          backgroundColor: "#f0f0f0",
          border: "2px solid #3b82f6",
          borderRadius: "8px",
        }}
        data-testid="overlap-container"
      >
        {/* Overlapping elements - edges touching */}
        <div
          style={{
            position: "absolute",
            top: "50px",
            left: "50px",
            width: "200px",
            height: "150px",
            backgroundColor: "#60a5fa",
            border: "2px solid #2563eb",
            borderRadius: "4px",
            padding: "15px",
            zIndex: 2,
          }}
          data-testid="overlap-element-1"
        >
          Element 1
          <br />
          <small>Right edge overlaps with Element 2</small>
        </div>

        <div
          style={{
            position: "absolute",
            top: "50px",
            left: "240px", // Overlaps by 10px
            width: "200px",
            height: "150px",
            backgroundColor: "#34d399",
            border: "2px solid #059669",
            borderRadius: "4px",
            padding: "15px",
            zIndex: 1,
          }}
          data-testid="overlap-element-2"
        >
          Element 2
          <br />
          <small>Left edge overlaps with Element 1</small>
        </div>

        {/* Vertically overlapping */}
        <div
          style={{
            position: "absolute",
            top: "220px",
            left: "50px",
            width: "200px",
            height: "150px",
            backgroundColor: "#fbbf24",
            border: "2px solid #d97706",
            borderRadius: "4px",
            padding: "15px",
            zIndex: 2,
          }}
          data-testid="overlap-element-3"
        >
          Element 3
          <br />
          <small>Bottom edge overlaps with Element 4</small>
        </div>

        <div
          style={{
            position: "absolute",
            top: "360px", // Overlaps by 10px
            left: "50px",
            width: "200px",
            height: "150px",
            backgroundColor: "#f87171",
            border: "2px solid #dc2626",
            borderRadius: "4px",
            padding: "15px",
            zIndex: 1,
          }}
          data-testid="overlap-element-4"
        >
          Element 4
          <br />
          <small>Top edge overlaps with Element 3</small>
        </div>

        {/* Corner overlap */}
        <div
          style={{
            position: "absolute",
            top: "220px",
            left: "300px",
            width: "150px",
            height: "150px",
            backgroundColor: "#a78bfa",
            border: "2px solid #7c3aed",
            borderRadius: "4px",
            padding: "15px",
            zIndex: 2,
          }}
          data-testid="overlap-element-5"
        >
          Element 5
          <br />
          <small>Corner overlap</small>
        </div>

        <div
          style={{
            position: "absolute",
            top: "360px",
            left: "440px", // Corner overlap
            width: "150px",
            height: "150px",
            backgroundColor: "#ec4899",
            border: "2px solid #be185d",
            borderRadius: "4px",
            padding: "15px",
            zIndex: 1,
          }}
          data-testid="overlap-element-6"
        >
          Element 6
          <br />
          <small>Corner overlap</small>
        </div>

        {/* Nested with edge overlap */}
        <div
          style={{
            position: "absolute",
            top: "50px",
            right: "50px",
            width: "250px",
            height: "300px",
            backgroundColor: "#fce7f3",
            border: "2px solid #ec4899",
            borderRadius: "4px",
            padding: "20px",
          }}
          data-testid="nested-overlap-container"
        >
          <div
            style={{
              width: "100%",
              height: "120px",
              backgroundColor: "#f9a8d4",
              border: "2px solid #ec4899",
              borderRadius: "4px",
              padding: "15px",
              marginBottom: "10px",
            }}
            data-testid="nested-child-1"
          >
            Nested Child 1
          </div>
          <div
            style={{
              width: "100%",
              height: "120px",
              backgroundColor: "#fbcfe8",
              border: "2px solid #ec4899",
              borderRadius: "4px",
              padding: "15px",
            }}
            data-testid="nested-child-2"
          >
            Nested Child 2
            <br />
            <small>Edge touches parent</small>
          </div>
        </div>
      </div>

      <div style={{ marginTop: "20px", fontSize: "12px", color: "#999" }}>
        <strong>Instructions:</strong>
        <ul style={{ marginTop: "10px", paddingLeft: "20px" }}>
          <li>Hold ALT key to activate measurement mode</li>
          <li>Click on any colored box to select it</li>
          <li>Move cursor near overlapping edges to test priority rules</li>
          <li>Test hysteresis - cursor should not jitter when near boundaries</li>
          <li>Verify "closest enclosing meaningful box wins" rule</li>
        </ul>
      </div>
    </div>
  );
}
