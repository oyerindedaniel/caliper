#!/usr/bin/env node

/**
 * Script to write the current package version to a static file.
 */

import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, "..");

const packageJsonPath = join(rootDir, "package.json");
const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf-8"));
const version = packageJson.version || "0.0.0";

const overlayPackageJsonPath = join(
  rootDir,
  "packages",
  "overlay",
  "package.json"
);
let overlayVersion = version;
try {
  const overlayPackageJson = JSON.parse(
    readFileSync(overlayPackageJsonPath, "utf-8")
  );
  overlayVersion = overlayPackageJson.version || version;
} catch (e) {

}

const versionInfo = {
  version: overlayVersion,
  timestamp: new Date().toISOString(),
};

const publicDir = join(rootDir, "public");
const versionFilePath = join(publicDir, "version.json");

try {
  mkdirSync(publicDir, { recursive: true });
  writeFileSync(versionFilePath, JSON.stringify(versionInfo, null, 2), "utf-8");
  console.log(`✓ Version written to ${versionFilePath}`);
  console.log(`  Version: ${overlayVersion}`);
} catch (error) {
  console.error("Error writing version file:", error);
  process.exit(1);
}
