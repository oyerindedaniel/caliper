export default function StressTestPage() {
    return (
        <div style={{ minHeight: "200vh", background: "#f5f5f5" }}>
            {/* Sticky Header */}
            <header style={{
                position: "sticky",
                top: 0,
                zIndex: 100,
                background: "rgba(255, 255, 255, 0.8)",
                backdropFilter: "blur(10px)",
                padding: "20px",
                borderBottom: "1px solid #ddd",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center"
            }}>
                <h1 style={{ margin: 0, fontSize: "20px" }}>Stress Test: Sticky, Fixed, & Funny Stuff</h1>
                <nav>
                    <a href="/" style={{ color: "#0070f3", textDecoration: "none" }}>Back to Home</a>
                </nav>
            </header>

            <main style={{ padding: "40px", display: "grid", gridTemplateColumns: "1fr 300px", gap: "40px" }}>
                <div style={{ display: "flex", flexDirection: "column", gap: "60px" }}>

                    {/* Section 1: Transforms and Absolute Positioning */}
                    <section style={{ border: "2px dashed #ccc", padding: "40px", borderRadius: "12px", background: "white", position: "relative" }}>
                        <h2>Transforms & Absolutes</h2>
                        <div style={{ height: "400px", position: "relative", background: "#f0f0f0", overflow: "hidden" }}>

                            <div id="rotated-box" style={{
                                width: "150px",
                                height: "150px",
                                background: "linear-gradient(135deg, #6e8efb, #a777e3)",
                                transform: "rotate(45deg)",
                                position: "absolute",
                                top: "100px",
                                left: "100px",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                color: "white",
                                fontWeight: "bold",
                                borderRadius: "8px"
                            }}>
                                Rotated (45°)
                            </div>

                            <div id="absolute-bottom-right" style={{
                                position: "absolute",
                                bottom: "20px",
                                right: "20px",
                                padding: "10px 20px",
                                background: "#f24e1e",
                                color: "white",
                                borderRadius: "4px"
                            }}>
                                Absolute corner
                            </div>
                        </div>
                    </section>

                    {/* Section 2: SVG Stress Test */}
                    <section style={{ border: "2px dashed #ccc", padding: "40px", borderRadius: "12px", background: "white" }}>
                        <h2>SVG Elements</h2>
                        <div style={{ display: "flex", gap: "20px", alignItems: "center" }}>
                            <svg width="200" height="200" viewBox="0 0 200 200" style={{ border: "1px solid #eee" }}>
                                <circle id="test-circle" cx="100" cy="100" r="80" fill="#18a0fb" opacity="0.5" />
                                <rect id="test-rect" x="50" y="50" width="100" height="100" stroke="#f24e1e" fill="none" strokeWidth="4" />
                                <path id="test-path" d="M10,10 L190,190 M10,190 L190,10" stroke="#333" strokeWidth="2" />
                            </svg>

                            <div style={{ flex: 1 }}>
                                <p>Testing measurement to SVG sub-elements:</p>
                                <ul>
                                    <li>The circle center vs container</li>
                                    <li>Inner rectangle vs outer container</li>
                                    <li>Diagonal paths</li>
                                </ul>
                            </div>
                        </div>
                    </section>

                    {/* Section 3: Nested Sticky */}
                    <section style={{ border: "2px dashed #ccc", padding: "40px", borderRadius: "12px", background: "white" }}>
                        <h2>Nested Sticky Container</h2>
                        <div style={{ height: "300px", overflow: "auto", border: "1px solid #ddd", background: "#fafafa" }}>
                            <div style={{ height: "1000px", padding: "20px", position: "relative" }}>
                                <div style={{
                                    position: "sticky",
                                    top: "20px",
                                    background: "#333",
                                    color: "white",
                                    padding: "10px",
                                    borderRadius: "4px",
                                    zIndex: 2
                                }}>
                                    Sticky inside scroll
                                </div>
                                <div style={{ height: "800px" }}></div>
                                <div id="sticky-bottom-target" style={{ height: "40px", background: "#ddd" }}>Target at bottom</div>
                            </div>
                        </div>
                    </section>

                    {/* Section 4: Image and Object-fit */}
                    <section style={{ border: "2px dashed #ccc", padding: "40px", borderRadius: "12px", background: "white" }}>
                        <h2>Images & Object Fit</h2>
                        <div style={{ display: "flex", gap: "20px" }}>
                            <div style={{ width: "200px", height: "200px", overflow: "hidden", border: "1px solid #ddd" }}>
                                <img
                                    id="test-img-cover"
                                    src="https://picsum.photos/seed/caliper/400/400"
                                    alt="Test"
                                    style={{ width: "100%", height: "100%", objectFit: "cover" }}
                                />
                            </div>
                            <div>
                                <p>Testing measurement to image boundaries with <code>object-fit: cover</code>.</p>
                            </div>
                        </div>
                    </section>
                </div>

                {/* Sidebar: Fixed Position */}
                <aside style={{ position: "relative" }}>
                    <div style={{
                        position: "fixed",
                        top: "100px",
                        right: "40px",
                        width: "250px",
                        padding: "20px",
                        background: "white",
                        border: "1px solid #ddd",
                        borderRadius: "8px",
                        boxShadow: "0 10px 30px rgba(0,0,0,0.1)"
                    }}>
                        <h3>Fixed Panel</h3>
                        <p style={{ fontSize: "14px", color: "#666" }}>
                            This panel is <code>fixed</code>. Measuring from here to elements within the scrolling main area is a classic coordinate system stress test.
                        </p>
                        <div id="fixed-target" style={{ height: "100px", background: "#18a0fb", color: "white", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: "bold" }}>
                            Fixed Element
                        </div>
                    </div>
                </aside>
            </main>

            {/* Floating Action Button */}
            <button style={{
                position: "fixed",
                bottom: "40px",
                right: "40px",
                width: "64px",
                height: "64px",
                borderRadius: "32px",
                background: "#18a0fb",
                color: "white",
                border: "none",
                fontSize: "24px",
                boxShadow: "0 10px 20px rgba(24, 160, 251, 0.4)",
                cursor: "pointer",
                zIndex: 1000
            }}>
                +
            </button>
        </div>
    );
}
