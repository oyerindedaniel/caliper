"use client";

import { useRef } from "react";

export function MeasurementDemo() {
  const containerRef = useRef<HTMLDivElement>(null);

  return (
    <div
      ref={containerRef}
      style={{
        padding: "40px",
        minHeight: "500px",
        border: "2px dashed #ccc",
        borderRadius: "8px",
        margin: "20px 0",
        position: "relative",
      }}
    >
      <h2 style={{ marginBottom: "20px" }}>Interactive Measurement Demo</h2>
      <p style={{ marginBottom: "30px", color: "#666" }}>
        Hold ALT key and move your cursor to see measurements. Click to select
        an element. Press SPACE to freeze measurements.
      </p>

      {/* Demo elements */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(3, 1fr)",
          gap: "20px",
          marginTop: "30px",
        }}
      >
        <div
          style={{
            padding: "30px",
            backgroundColor: "#dbeafe",
            border: "2px solid #3b82f6",
            borderRadius: "8px",
            minHeight: "150px",
          }}
          data-demo="demo-1"
        >
          <h3 style={{ margin: "0 0 10px 0" }}>Demo Element 1</h3>
          <p style={{ margin: 0, fontSize: "14px", color: "#666" }}>
            Hold ALT and hover to measure
          </p>
        </div>

        <div
          style={{
            padding: "30px",
            backgroundColor: "#d1fae5",
            border: "2px solid #10b981",
            borderRadius: "8px",
            minHeight: "150px",
          }}
          data-demo="demo-2"
        >
          <h3 style={{ margin: "0 0 10px 0" }}>Demo Element 2</h3>
          <p style={{ margin: 0, fontSize: "14px", color: "#666" }}>
            Hold ALT and hover to measure
          </p>
        </div>

        <div
          style={{
            padding: "30px",
            backgroundColor: "#fef3c7",
            border: "2px solid #f59e0b",
            borderRadius: "8px",
            minHeight: "150px",
          }}
          data-demo="demo-3"
        >
          <h3 style={{ margin: "0 0 10px 0" }}>Demo Element 3</h3>
          <p style={{ margin: 0, fontSize: "14px", color: "#666" }}>
            Hold ALT and hover to measure
          </p>
        </div>
      </div>

      {/* Nested structure */}
      <div
        style={{
          marginTop: "30px",
          padding: "40px",
          backgroundColor: "#f3f4f6",
          border: "2px solid #6b7280",
          borderRadius: "8px",
        }}
        data-demo="nested-parent"
      >
        <h3 style={{ margin: "0 0 20px 0" }}>Nested Structure</h3>
        <div
          style={{
            display: "flex",
            gap: "20px",
            flexWrap: "wrap",
          }}
        >
          <div
            style={{
              padding: "20px",
              backgroundColor: "#e0e7ff",
              border: "2px solid #6366f1",
              borderRadius: "4px",
              flex: "1",
              minWidth: "200px",
            }}
            data-demo="nested-child-1"
          >
            Nested Child 1
          </div>
          <div
            style={{
              padding: "20px",
              backgroundColor: "#fce7f3",
              border: "2px solid #ec4899",
              borderRadius: "4px",
              flex: "1",
              minWidth: "200px",
            }}
            data-demo="nested-child-2"
          >
            Nested Child 2
          </div>
        </div>
      </div>

      <div style={{ marginTop: "20px", fontSize: "12px", color: "#999" }}>
        <strong>Instructions:</strong>
        <ul style={{ marginTop: "10px", paddingLeft: "20px" }}>
          <li>Hold ALT key to activate measurement mode</li>
          <li>Move cursor over elements to see measurements</li>
          <li>Click on a measurement line to open calculator</li>
          <li>Press SPACE to freeze current measurement</li>
          <li>Release ALT to exit measurement mode</li>
        </ul>
      </div>
    </div>
  );
}
