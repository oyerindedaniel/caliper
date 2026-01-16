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
  const content = await fs.readFile(changelogPath, "utf-8");
  return parseChangelog(content);
}

export default async function Changelog() {
  const changelog = await getChangelog();
  return <ChangelogPage changelog={changelog} />;
}
