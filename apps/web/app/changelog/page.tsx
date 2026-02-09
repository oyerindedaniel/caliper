import { Metadata } from "next";
import { promises as fs } from "fs";
import path from "path";
import ChangelogPage from "./changelog-page";
import { parseChangelog } from "./parse-changelog";

export const metadata: Metadata = {
  title: "Changelog",
};

async function getChangelog() {
  const changelogPath = path.join(process.cwd(), "..", "..", "packages", "caliper", "CHANGELOG.md");
  try {
    const content = await fs.readFile(changelogPath, "utf-8");
    return parseChangelog(content);
  } catch (err) {
    console.error("Failed to read changelog at:", changelogPath);
    throw err;
  }
}

export default async function Changelog() {
  const changelog = await getChangelog();
  return <ChangelogPage changelog={changelog} />;
}
