"use client";

import { useRef } from "react";

export function ScrollContainerTest() {
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  return (
    <div
      style={{
        padding: "40px",
        minHeight: "600px",
        border: "2px dashed #ccc",
        borderRadius: "8px",
        margin: "20px 0",
      }}
    >
      <h2 style={{ marginBottom: "20px" }}>Scroll Container Test</h2>
      <p style={{ marginBottom: "30px", color: "#666" }}>
        Test scroll-aware geometry measurements. Scroll the container and measure elements at
        different scroll positions.
      </p>

      {/* Scrollable container */}
      <div
        ref={scrollContainerRef}
        style={{
          width: "100%",
          height: "400px",
          overflow: "auto",
          border: "2px solid #3b82f6",
          borderRadius: "8px",
          backgroundColor: "#f9fafb",
          padding: "20px",
        }}
        data-testid="scroll-container"
      >
        <div
          style={{
            width: "200%",
            minHeight: "800px",
            position: "relative",
            padding: "40px",
          }}
        >
          {/* Element at top-left */}
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
              padding: "20px",
            }}
            data-testid="element-top-left"
          >
            Element at Top-Left
            <br />
            <small>Scroll to see measurements</small>
          </div>

          {/* Element at top-right */}
          <div
            style={{
              position: "absolute",
              top: "50px",
              right: "50px",
              width: "200px",
              height: "150px",
              backgroundColor: "#34d399",
              border: "2px solid #059669",
              borderRadius: "4px",
              padding: "20px",
            }}
            data-testid="element-top-right"
          >
            Element at Top-Right
            <br />
            <small>Scroll to see measurements</small>
          </div>

          {/* Element at bottom-left */}
          <div
            style={{
              position: "absolute",
              bottom: "50px",
              left: "50px",
              width: "200px",
              height: "150px",
              backgroundColor: "#fbbf24",
              border: "2px solid #d97706",
              borderRadius: "4px",
              padding: "20px",
            }}
            data-testid="element-bottom-left"
          >
            Element at Bottom-Left
            <br />
            <small>Scroll to see measurements</small>
          </div>

          {/* Element at bottom-right */}
          <div
            style={{
              position: "absolute",
              bottom: "50px",
              right: "50px",
              width: "200px",
              height: "150px",
              backgroundColor: "#f87171",
              border: "2px solid #dc2626",
              borderRadius: "4px",
              padding: "20px",
            }}
            data-testid="element-bottom-right"
          >
            Element at Bottom-Right
            <br />
            <small>Scroll to see measurements</small>
          </div>

          {/* Center element */}
          <div
            style={{
              position: "absolute",
              top: "50%",
              left: "50%",
              transform: "translate(-50%, -50%)",
              width: "250px",
              height: "200px",
              backgroundColor: "#a78bfa",
              border: "2px solid #7c3aed",
              borderRadius: "4px",
              padding: "20px",
            }}
            data-testid="element-center"
          >
            Center Element
            <br />
            <small>Scroll to see measurements</small>
          </div>

          {/* Nested scroll container */}
          <div
            style={{
              position: "absolute",
              top: "300px",
              left: "300px",
              width: "300px",
              height: "200px",
              overflow: "auto",
              border: "2px solid #ec4899",
              borderRadius: "4px",
              backgroundColor: "#fce7f3",
              padding: "15px",
            }}
            data-testid="nested-scroll-container"
          >
            <div style={{ width: "150%", minHeight: "300px" }}>
              <div
                style={{
                  width: "150px",
                  height: "100px",
                  backgroundColor: "#f472b6",
                  margin: "20px",
                  padding: "15px",
                  borderRadius: "4px",
                }}
                data-testid="element-in-nested-scroll"
              >
                Element in Nested Scroll
              </div>
            </div>
          </div>
        </div>
      </div>

      <div style={{ marginTop: "20px", fontSize: "12px", color: "#999" }}>
        <strong>Instructions:</strong>
        <ul style={{ marginTop: "10px", paddingLeft: "20px" }}>
          <li>Hold ALT key to activate measurement mode</li>
          <li>Click on any colored box to select it</li>
          <li>Scroll the container and observe how measurements adapt</li>
          <li>Test measurements at different scroll positions</li>
          <li>Try the nested scroll container for complex scenarios</li>
        </ul>
      </div>
    </div>
  );
}
