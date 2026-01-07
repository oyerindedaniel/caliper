import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
    try {
        const filePath = path.join(process.cwd(), "..", "..", "packages", "caliper", "dist", "index.global.js");

        const content = await readFile(filePath, "utf8");

        return new NextResponse(content, {
            headers: {
                "Content-Type": "application/javascript",
                "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
                "Pragma": "no-cache",
                "Expires": "0",
                "Surrogate-Control": "no-store"
            },
        });
    } catch (error) {
        console.error("Failed to serve caliper.js:", error);
        return new NextResponse(`console.error('Caliper bundle not found at: ${error}');`, {
            headers: { "Content-Type": "application/javascript" },
            status: 200,
        });
    }
}
