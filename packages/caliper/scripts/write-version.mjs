#!/usr/bin/env node

/**
 * Script to write the current package version to the web application's public directory.
 * This ensures that the hosted version.json matches the NPM package version,
 * allowing the core logic to detect updates via https://caliper.danieloyerinde.com/version.json
 */

import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const packageDir = join(__dirname, "..");
const rootDir = join(packageDir, "../..");

const packageJsonPath = join(packageDir, "package.json");
const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf-8"));
const version = packageJson.version || "0.0.0";

const versionInfo = {
    version: version,
    timestamp: new Date().toISOString(),
};

const distDir = join(packageDir, "dist");
const webPublicDir = join(rootDir, "apps/web/public");

try {
    mkdirSync(distDir, { recursive: true });
    writeFileSync(join(distDir, "version.json"), JSON.stringify(versionInfo, null, 2), "utf-8");

    mkdirSync(webPublicDir, { recursive: true });
    const versionFilePath = join(webPublicDir, "version.json");
    writeFileSync(versionFilePath, JSON.stringify(versionInfo, null, 2), "utf-8");

    console.log(`✓ Version metadata synchronized:`);
    console.log(`  Version: ${version}`);
    console.log(`  Deployed to: ${versionFilePath}`);
} catch (error) {
    console.error("Error writing version metadata:", error);
    process.exit(1);
}
