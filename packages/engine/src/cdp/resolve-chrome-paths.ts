import { existsSync } from "node:fs";
import { join, win32 } from "node:path";

const CHROME_EXECUTABLE_ENV = "CALIPER_CHROME_PATH";

const WINDOWS_ENV_NAMES = [
  "PROGRAMFILES",
  "ProgramW6432",
  "ProgramFiles(x86)",
  "LOCALAPPDATA",
] as const;

const WINDOWS_FALLBACK_PREFIXES = [
  "C:\\Program Files",
  "C:\\Program Files (x86)",
  "D:\\Program Files",
  "D:\\Program Files (x86)",
];

const LINUX_CHROME_PATHS = [
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/opt/google/chrome/google-chrome",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
];

function getStableChromeSuffix(): string {
  return join("Google", "Chrome", "Application", "chrome.exe");
}

export function resolveSystemChromePaths(): string[] {
  if (process.platform === "win32") {
    const suffix = getStableChromeSuffix();
    const prefixes = new Set<string>();

    for (const envName of WINDOWS_ENV_NAMES) {
      const value = process.env[envName];
      if (value) {
        prefixes.add(value);
      }
    }

    for (const fallbackPrefix of WINDOWS_FALLBACK_PREFIXES) {
      prefixes.add(fallbackPrefix);
    }

    return [...prefixes].map((prefix) => win32.join(prefix, suffix));
  }

  if (process.platform === "darwin") {
    return ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"];
  }

  return LINUX_CHROME_PATHS;
}

export function resolveChromeExecutable(customPath?: string): string {
  if (customPath && existsSync(customPath)) {
    return customPath;
  }

  const envPath = process.env[CHROME_EXECUTABLE_ENV];
  if (envPath && existsSync(envPath)) {
    return envPath;
  }

  const candidates = resolveSystemChromePaths();
  const matches = candidates.filter((candidate) => candidate && existsSync(candidate));

  if (matches.length === 0) {
    throw new Error(
      `Chrome executable not found. Checked:\n${candidates.map((candidate) => ` - ${candidate}`).join("\n")}\nInstall Google Chrome or set ${CHROME_EXECUTABLE_ENV}.`
    );
  }

  return matches[0]!;
}
