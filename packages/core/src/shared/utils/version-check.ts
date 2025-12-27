interface VersionInfo {
  version: string;
  timestamp: string;
}

const CALIPER_ASCII = `
   ___   _   _    ___ ___ ___ ___ 
  / __| /_\\ | |  |_ _| _ \\ __| _ \\
 | (__ / _ \\| |__ | ||  _/ _||   /
  \\___/_/ \\_\\____|___|_| |___|_|_\\

          Measurement Tool
`;

async function fetchLatestVersion(): Promise<VersionInfo | null> {
  try {
    const timestamp = Date.now();
    const endpoint = `https://caliper.danieloyerinde.com/version.json?t=${timestamp}`;

    const response = await fetch(endpoint, {
      method: "GET",
      mode: "cors",
      cache: "no-store",
      credentials: "omit",
      headers: {
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(2000),
    });

    if (response.ok) {
      return await response.json();
    }
  } catch (error) {
    // Silently fail
  }
  return null;
}

/**
 * Compares two version strings (semver format)
 * Returns: -1 if v1 < v2, 0 if v1 === v2, 1 if v1 > v2
 */
function compareVersions(v1: string, v2: string): number {
  const parts1 = v1.split(".").map(Number);
  const parts2 = v2.split(".").map(Number);

  for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
    const part1 = parts1[i] || 0;
    const part2 = parts2[i] || 0;
    if (part1 < part2) return -1;
    if (part1 > part2) return 1;
  }
  return 0;
}

export async function showVersionInfo(currentVersion: string): Promise<void> {
  if (typeof window === "undefined") return;

  console.log(
    `%c${CALIPER_ASCII}\n%cVersion: ${currentVersion}`,
    "color: #3b82f6; font-weight: bold; font-family: monospace;",
    "color: #6b7280; font-family: monospace;"
  );

  fetchLatestVersion()
    .then((latestInfo) => {
      if (!latestInfo) return;

      const comparison = compareVersions(currentVersion, latestInfo.version);
      if (comparison < 0) {
        console.log(
          `%c⚠ Update available: ${latestInfo.version} (you're on ${currentVersion})\n%cRun: npm install @caliper/overlay@latest`,
          "color: #f59e0b; font-weight: bold; font-family: monospace;",
          "color: #6b7280; font-family: monospace;"
        );
      }
    })
    .catch(() => {
      // Silently fail
    });
}
