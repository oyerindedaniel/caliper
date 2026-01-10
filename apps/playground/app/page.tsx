import { ParentSiblingTest } from "./components/test-cases/parent-sibling";
import { ScrollContainerTest } from "./components/test-cases/scroll-container";
import { EdgeOverlapsTest } from "./components/test-cases/edge-overlaps";
import { MeasurementDemo } from "./components/measurement-demo";

export default function Playground() {
  return (
    <div style={{ maxWidth: "1400px", margin: "0 auto", padding: "40px 20px" }}>
      <header style={{ marginBottom: "40px" }}>
        <h1 style={{ fontSize: "32px", marginBottom: "10px" }}>CALIPER Playground</h1>
        <p style={{ fontSize: "16px", color: "#666" }}>
          Visual sandbox for testing measurement behavior and edge cases.
          <a
            href="/stress-test"
            style={{ marginLeft: "15px", color: "#0070f3", fontWeight: "bold" }}
          >
            Launch Stress Test →
          </a>
        </p>
      </header>

      <section style={{ marginBottom: "60px" }}>
        <MeasurementDemo />
      </section>

      <section style={{ marginBottom: "60px" }}>
        <ParentSiblingTest />
      </section>

      <section style={{ marginBottom: "60px" }}>
        <ScrollContainerTest />
      </section>

      <section style={{ marginBottom: "60px" }}>
        <EdgeOverlapsTest />
      </section>

      <footer style={{ marginTop: "60px", padding: "20px", textAlign: "center", color: "#999" }}>
        <p>CALIPER Measurement Tool - Playground Environment</p>
      </footer>
    </div>
  );
}
