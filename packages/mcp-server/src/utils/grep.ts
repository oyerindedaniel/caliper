import { spawnSync } from "child_process";
import path from "path";
import { MAX_BUFFER_SIZE, MAX_GREP_RESULTS } from "../shared/constants.js";

export interface GrepResult {
    file: string;
    line: number;
    content: string;
    matchType: "exact" | "partial" | "tag-context";
}

const FRONTEND_EXTENSIONS = [
    "tsx", "jsx", "ts", "js", "vue", "svelte", "html", "css", "scss", "module.css"
];

function runRg(args: string[], rootDir: string): string {
    try {
        const result = spawnSync("rg", args, {
            cwd: rootDir,
            encoding: "utf8",
            maxBuffer: MAX_BUFFER_SIZE,
            shell: false
        });

        if (result.status === 0) {
            return result.stdout;
        }

        // Status 1: No matches found
        if (result.status === 1) {
            return "";
        }

        console.error("Ripgrep execution error:", result.error || result.stderr);
        return "";
    } catch (e) {
        console.error("Failed to run ripgrep:", e);
        return "";
    }
}

function parseRgOutput(output: string, rootDir: string, matchType: GrepResult["matchType"]): GrepResult[] {
    if (!output.trim()) return [];

    const lines = output.trim().split("\n");
    const results: GrepResult[] = [];

    for (const line of lines) {
        if (!line) continue;

        // RG output format with --line-number: file:line:content
        const parts = line.split(":");
        if (parts.length < 3) continue;

        const relativeFile = parts[0];
        const lineNumberStr = parts[1];

        if (relativeFile === undefined || lineNumberStr === undefined) continue;

        const lineNumber = parseInt(lineNumberStr, 10);
        const content = parts.slice(2).join(":").trim();

        if (!isNaN(lineNumber)) {
            const absolutePath = path.isAbsolute(relativeFile)
                ? relativeFile
                : path.join(rootDir, relativeFile);

            results.push({
                file: absolutePath,
                line: lineNumber,
                content,
                matchType
            });
        }
    }

    return results;
}

export function caliperGrep(query: string, rootDir: string, tag?: string): GrepResult[] {
    const results: GrepResult[] = [];
    const normalizedRootDir = path.normalize(rootDir);

    const baseArgs = [
        "--line-number",
        "--no-heading",
        "--color", "never",
        "--type-add", `caliper:*.{${FRONTEND_EXTENSIONS.join(",")}}`,
        "-t", "caliper",
    ];

    // Strategy 1: Exact match (highest priority)
    const exactArgs = [...baseArgs, "--word-regexp", query];
    results.push(...parseRgOutput(runRg(exactArgs, normalizedRootDir), normalizedRootDir, "exact"));

    if (results.length >= MAX_GREP_RESULTS) {
        return results.slice(0, MAX_GREP_RESULTS);
    }

    // Strategy 2: Tag + Text combo (e.g. <span>Query</span>)
    if (tag && query.length > 2) {
        const tagPattern = `<${tag}[^>]*>.*${query}`;
        const tagArgs = [...baseArgs, "-e", tagPattern];
        const tagResults = parseRgOutput(runRg(tagArgs, normalizedRootDir), normalizedRootDir, "tag-context");

        for (const r of tagResults) {
            if (!results.some(x => x.file === r.file && x.line === r.line)) {
                results.push(r);
            }
        }
    }

    if (results.length >= MAX_GREP_RESULTS) {
        return results.slice(0, MAX_GREP_RESULTS);
    }

    // Strategy 3: Partial match for short queries
    if (query.length <= 15 && results.length < 10) {
        const partialArgs = [...baseArgs, query];
        const partialResults = parseRgOutput(runRg(partialArgs, normalizedRootDir), normalizedRootDir, "partial");

        for (const r of partialResults) {
            if (!results.some(x => x.file === r.file && x.line === r.line)) {
                results.push(r);
            }
        }
    }

    return results.slice(0, MAX_GREP_RESULTS);
}
