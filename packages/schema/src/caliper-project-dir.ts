import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import {
  CALIPER_RUNTIME_CHANNEL_FILES,
  type CaliperProjectPaths,
} from "./caliper-runtime-paths.js";

export { CALIPER_RUNTIME_CHANNEL_FILES, type CaliperRuntimeChannel, type CaliperProjectPaths } from "./caliper-runtime-paths.js";

/**
 * Resolves the Caliper project root directory.
 * Priority: CALIPER_PROJECT_ROOT → walk upward for .git or package.json → start directory.
 */
export function resolveCaliperProjectRoot(startDirectory: string = process.cwd()): string {
  const environmentRoot = process.env.CALIPER_PROJECT_ROOT?.trim();
  if (environmentRoot) {
    return resolve(environmentRoot);
  }

  let currentDirectory = resolve(startDirectory);
  for (;;) {
    if (
      existsSync(join(currentDirectory, ".git")) ||
      existsSync(join(currentDirectory, "package.json"))
    ) {
      return currentDirectory;
    }

    const parentDirectory = dirname(currentDirectory);
    if (parentDirectory === currentDirectory) {
      break;
    }
    currentDirectory = parentDirectory;
  }

  return resolve(startDirectory);
}

export function resolveCaliperProjectPaths(
  startDirectory: string = process.cwd()
): CaliperProjectPaths {
  const projectRoot = resolveCaliperProjectRoot(startDirectory);
  const caliperDir = resolve(projectRoot, ".caliper");
  const runtimeDir = resolve(caliperDir, "runtime");
  const capturesDir = resolve(caliperDir, "captures");
  const fingerprintPath = resolve(runtimeDir, "fingerprint.json");
  const captureEnabledPath = resolve(runtimeDir, "capture.enabled.json");

  const channelPaths = {
    console: resolve(runtimeDir, CALIPER_RUNTIME_CHANNEL_FILES.console),
    exceptions: resolve(runtimeDir, CALIPER_RUNTIME_CHANNEL_FILES.exceptions),
    logs: resolve(runtimeDir, CALIPER_RUNTIME_CHANNEL_FILES.logs),
    networkFailures: resolve(runtimeDir, CALIPER_RUNTIME_CHANNEL_FILES.networkFailures),
  } satisfies CaliperProjectPaths["channelPaths"];

  return {
    projectRoot,
    caliperDir,
    runtimeDir,
    capturesDir,
    fingerprintPath,
    captureEnabledPath,
    channelPaths,
  };
}
