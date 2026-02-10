interface VersionInfo {
  version: string;
  timestamp: string;
}

const CALIPER_LOGO_SVG = `data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTcyIiBoZWlnaHQ9IjUwIiB2aWV3Qm94PSIwIDAgMTcyIDUwIiBmaWxsPSJub25lIiB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciPgo8cGF0aCBmaWxsLXJ1bGU9ImV2ZW5vZGQiIGNsaXAtcnVsZT0iZXZlbm9kZCIgZD0iTTQ3LjIxNDQgNy42MjkzOWUtMDZIMzIuNzkyOEwyNS44MjUgNDMuMzIyNUgzNS4wNjEzTDM2LjE5NTYgMzUuMDE2M0g0NC4xMzU2TDQ1LjI2OTkgNDMuMzIyNUg1NC42NjgzTDQ3LjIxNDQgNy42MjkzOWUtMDZaTTM5LjU5ODUgOC4zMDYySDQwLjczMjhMNDQuMTM1NiAyOC4xNzU5SDM2LjE5NTZMMzkuNTk4NSA4LjMwNjJaIiBmaWxsPSIjQUMyMzIzIi8+CjxwYXRoIGZpbGwtcnVsZT0iZXZlbm9kZCIgY2xpcC1ydWxlPSJldmVub2RkIiBkPSJNNS4wMjMyOCAwTDAgNS4wNDg4NlYyOC4zMzg4TDUuMTg1MzIgMzMuMzg3NkgxNy41MDA0VjM1LjM0MkgxNS41NTZWNDYuNzQyN0gxOS4xMjA5TDI0LjMwNjIgMzUuNjY3OFYyNS44OTU4SDcuMTI5ODFWNy4zMjg5OUgxMy40NDk0VjBINS4wMjMyOFoiIGZpbGw9IiNBQzIzMjMiLz4KPHBhdGggZmlsbC1ydWxlPSJldmVub2RkIiBjbGlwLXJ1bGU9ImV2ZW5vZGQiIGQ9Ik02Ni40OTc0IDcuNjI5MzllLTA2SDU3LjI2MVY0LjM5NzRINjIuNDQ2M1Y1LjIxMTczSDU3LjI2MVY2LjY3NzU0SDYwLjE3NzdWNy4zMjg5OUg1Ny4yNjFWOC45NTc2Nkg2MC4xNzc3VjkuNjA5MTNINTcuMjYxVjExLjA3NDlINjAuMTc3N1YxMS43MjY0SDU3LjI2MVYxMy4xOTIySDYyLjQ0NjNWMTMuODQzN0g1Ny4yNjFWMTUuNDcyM0g2MC4xNzc3VjE2LjEyMzhINTcuMjYxVjE3LjU4OTZINjAuMTc3N1YxOC4yNDExSDU3LjI2MVYxOS44Njk3SDYwLjE3NzdWMjAuNTIxMkg1Ny4yNjFWMjEuODI0MUg2Mi40NDYzVjIyLjYzODRINTcuMjYxVjI0LjI2NzFINjAuMTc3N1YyNC43NTU3SDU3LjI2MVYyNi4zODQ0SDYwLjE3NzdWMjcuMDM1OEg1Ny4yNjFWMjguNTAxNkg2MC4xNzc3VjI5LjE1MzFINTcuMjYxVjMwLjYxODlINjIuNDQ2M1YzMS40MzMySDU3LjI2MVYzMi44OTlINjAuMTc3N1YzMy41NTA1SDU3LjI2MVYzNS4wMTYzSDYwLjE3NzdWMzUuODMwNkg1Ny4yNjFWMzcuMjk2NEg2MC4xNzc3VjM3Ljk0NzlINTcuMjYxVjM5LjQxMzdINjIuNDQ2M1Y0MC4yMjhINTcuMjYxVjQzLjMyMjVINzcuODQwMlYzNS4wMTYzSDY2LjQ5NzRWNy42MjkzOWUtMDZaIiBmaWxsPSIjQUMyMzIzIi8+CjxwYXRoIGZpbGwtcnVsZT0iZXZlbm9kZCIgY2xpcC1ydWxlPSJldmVub2RkIiBkPSJNNzcuODQwMiAyNy42ODczSDY3LjQ2OTZMNjkuNDE0MSAzMC42MTg5TDc5Ljc4NDcgMzQuMjAyVjQzLjk3MzlDNzcuNTQzOSA0NC4zNzMgNzYuNTQzOSA0NS4yNzY5IDc2LjU0MzkgNDcuMDY4NEM3Ni41NDM5IDQ5LjE4NTcgNzcuNTc4IDQ5Ljg1MjEgNzkuNzg0NyA1MEg4Mi44NjM1VjI4LjUwMTZINzcuODQwMlYyNy42ODczWiIgZmlsbD0iI0FDMjMyMyIvPgo8cGF0aCBmaWxsLXJ1bGU9ImV2ZW5vZGQiIGNsaXAtcnVsZT0iZXZlbm9kZCIgZD0iTTg5Ljk5MzMgNy42MjkzOWUtMDZIODAuNzU3VjQuMzk3NEg4NS43ODAzVjUuMjExNzNIODAuNzU3VjYuNjc3NTRIODMuNTExN1Y3LjMyODk5SDgwLjc1N1Y4Ljk1NzY2SDgzLjUxMTdWOS40NDYyNkg4MC43NTdWMTEuMDc0OUg4My41MTE3VjExLjcyNjRIODAuNzU3VjEzLjE5MjJIODUuNzgwM1YxMy44NDM3SDgwLjc1N1YxNS40NzIzSDgzLjUxMTdWMTYuMTIzOEg4MC43NTdWMTcuNTg5Nkg4My41MTE3VjE4LjI0MTFIODAuNzU3VjE5Ljg2OTdIODMuNTExN1YyMC41MjEySDgwLjc1N1YyMS44MjQxSDg1Ljc4MDNWMjIuNjM4NEg4MC43NTdWMjcuMDM1OEg4My44MzU4VjQzLjMyMjVIODcuMjM4NlYxMi4zNzc5SDkyLjI2MTlWOS40NDYyNkg5My4wNzIxVjEwLjA5NzdIOTkuNzE1OEM5OC45MDU2IDguNzk0NzkgOTcuMTIzMSA3LjY1NDczIDk0Ljg1NDYgNy4wMDMyN0g4OS45OTMzVjcuNjI5MzllLTA2WiIgZmlsbD0iI0FDMjMyMyIvPgo8cGF0aCBmaWxsLXJ1bGU9ImV2ZW5vZGQiIGNsaXAtcnVsZT0iZXZlbm9kZCIgZD0iTTkyLjI2MTkgMTMuODQzN0g4OC4wNDg4VjQzLjMyMjVIOTIuMjYxOVYyOC41MDE2SDkzLjA3MjFWMjkuMzE2SDk0Ljg1NDZWMjUuNTdIOTMuMDcyMVYyNi4zODQ0SDkyLjI2MTlWMTMuODQzN1oiIGZpbGw9IiNBQzIzMjMiLz4KPHBhdGggZmlsbC1ydWxlPSJldmVub2RkIiBjbGlwLXJ1bGU9ImV2ZW5vZGQiIGQ9Ik05NS42NjQ4IDYuMzUxOFY3LjYyOTM5ZS0wNkgxMTMuMDAzTDExOS42NDcgNi4zNTE4VjIxLjgyNDFMMTEzLjAwMyAyOC41MDE2SDEwNC45MDFMMTA0LjczOSA0My4zMjI1SDk1LjY2NDhWMTEuMDc0OUgxMDAuODVDMTAwLjUyNiA4LjYzMTkzIDk4LjkwNTYgNy4zMjkgOTUuNjY0OCA2LjM1MThaTTEwNC45MDEgNy45ODA0NkgxMTAuNTczVjIwLjUyMTJIMTA0LjkwMVY3Ljk4MDQ2WiIgZmlsbD0iI0FDMjMyMyIvPgo8cGF0aCBmaWxsLXJ1bGU9ImV2ZW5vZGQiIGNsaXAtcnVsZT0iZXZlbm9kZCIgZD0iTTE0My4zMDUgNy42MjkzOWUtMDZIMTIzLjIxMlY0My4zMjI1SDE0My4zMDVWMzUuMDE2M0gxMzIuNDQ4VjI0LjQzSDE0MS42ODVWMTYuMTIzOEgxMzIuNDQ4VjcuOTgwNDZIMTQzLjMwNVY3LjYyOTM5ZS0wNloiIGZpbGw9IiNBQzIzMjMiLz4KPHBhdGggZmlsbC1ydWxlPSJldmVub2RkIiBjbGlwLXJ1bGU9ImV2ZW5vZGQiIGQ9Ik0xNDcuMTk0IDQzLjMyMjVWNy42MjkzOWUtMDZIMTY1LjE4TDE3MS41IDUuODYzMlYxNi45MzgxTDE2Ni4xNTMgMjEuODI0MUwxNzEuNSAyNS41N1Y0My4zMjI1SDE2Mi40MjZWMjUuNTdIMTU2LjI2OFY0My4zMjI1SDE0Ny4xOTRaTTE1Ni4yNjggNy45ODA0NkgxNjIuNDI2VjE3LjU4OTZIMTU2LjI2OFY3Ljk4MDQ2WiIgZmlsbD0iI0FDMjMyMyIvPgo8L3N2Zz4K`;

async function fetchLatestVersion(): Promise<VersionInfo | null> {
  try {
    const endpoint = `https://unpkg.com/@oyerinde/caliper@latest/dist/version.json`;
    const response = await fetch(endpoint, {
      method: "GET",
      cache: "no-store",
      headers: {
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(3000),
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

/**
 * Logs the current Caliper version and check for updates in the browser console.
 * 
 * @param currentVersion - The current version of the package.
 */
export async function showVersionInfo(currentVersion: string): Promise<void> {
  if (typeof window === "undefined") return;

  const style = `
    font-size: 1px;
    padding: 10px 34px;
    background-image: url('${CALIPER_LOGO_SVG}');
    background-size: contain;
    background-repeat: no-repeat;
    background-position: center;
  `;

  console.log(`%c `, style);
  console.log(
    `%cMeasurement Tool v${currentVersion}\n%cDocs -> https://caliper.danieloyerinde.com`,
    "color: #3b82f6; font-weight: bold; font-family: monospace; padding-top: 5px;",
    "color: #6b7280; font-family: monospace;"
  );

  if (currentVersion === "[DEV]") return;

  fetchLatestVersion()
    .then((latestInfo) => {
      if (!latestInfo) return;

      const comparison = compareVersions(currentVersion, latestInfo.version);
      if (comparison < 0) {
        console.log(
          `%c⚠ Update available: ${latestInfo.version} (you're on ${currentVersion})`,
          "color: #f59e0b; font-weight: bold; font-family: monospace;"
        );
      }
    })
    .catch(() => {
      // Silently fail
    });
}
