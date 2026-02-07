export interface ChangelogItem {
  text: string;
}

export interface ChangelogSection {
  title: string; // e.g., "Fixed", "Added", "Improved"
  items: ChangelogItem[];
}

export interface ChangelogVersion {
  version: string; // e.g., "0.1.3"
  date: string; // e.g., "2026-01-13"
  sections: ChangelogSection[];
}

export interface ParsedChangelog {
  title: string;
  description: string;
  versions: ChangelogVersion[];
}

/**
 * Parses a Keep-a-Changelog style markdown file into structured data.
 */
export function parseChangelog(markdown: string): ParsedChangelog {
  const lines = markdown.split("\n");
  const versions: ChangelogVersion[] = [];

  let title = "Changelog";
  let description = "";
  let currentVersion: ChangelogVersion | null = null;
  let currentSection: ChangelogSection | null = null;

  for (const line of lines) {
    const trimmed = line.trim();

    if (trimmed.startsWith("# ")) {
      title = trimmed.slice(2).trim();
      continue;
    }

    if (
      !trimmed.startsWith("#") &&
      !trimmed.startsWith("-") &&
      trimmed.length > 0 &&
      versions.length === 0 &&
      !currentVersion
    ) {
      description = trimmed;
      continue;
    }

    const versionMatch = trimmed.match(/^## \[(.+?)\] - (.+)$/);
    if (versionMatch) {
      if (currentVersion) {
        if (currentSection) {
          currentVersion.sections.push(currentSection);
          currentSection = null;
        }
        versions.push(currentVersion);
      }
      currentVersion = {
        version: versionMatch[1]!,
        date: versionMatch[2]!,
        sections: [],
      };
      continue;
    }

    const sectionMatch = trimmed.match(/^### (.+)$/);
    if (sectionMatch && currentVersion) {
      if (currentSection) {
        currentVersion.sections.push(currentSection);
      }
      currentSection = {
        title: sectionMatch[1]!,
        items: [],
      };
      continue;
    }

    if (trimmed.startsWith("- ") && currentSection) {
      currentSection.items.push({
        text: trimmed.slice(2).trim(),
      });
      continue;
    }
  }

  if (currentSection && currentVersion) {
    currentVersion.sections.push(currentSection);
  }
  if (currentVersion) {
    versions.push(currentVersion);
  }

  return { title, description, versions };
}
