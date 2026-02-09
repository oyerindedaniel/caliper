"use client";

import Image from "next/image";
import Link from "next/link";
import styles from "@/app/page.module.css";
import type { ParsedChangelog } from "./parse-changelog";

interface ChangelogPageProps {
  changelog: ParsedChangelog;
}

/**
 * Renders inline markdown
 */
function renderInlineMarkdown(text: string): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  let remaining = text;
  let key = 0;

  while (remaining.length > 0) {
    const boldMatch = remaining.match(/\*\*(.+?)\*\*/);
    const codeMatch = remaining.match(/`(.+?)`/);
    const boldIndex = boldMatch?.index ?? Infinity;
    const codeIndex = codeMatch?.index ?? Infinity;

    if (boldIndex === Infinity && codeIndex === Infinity) {
      parts.push(remaining);
      break;
    }

    if (boldIndex < codeIndex) {
      if (boldIndex > 0) {
        parts.push(remaining.slice(0, boldIndex));
      }
      parts.push(<strong key={key++}>{boldMatch![1]}</strong>);
      remaining = remaining.slice(boldIndex + boldMatch![0].length);
    } else {
      if (codeIndex > 0) {
        parts.push(remaining.slice(0, codeIndex));
      }
      parts.push(<code key={key++}>{codeMatch![1]}</code>);
      remaining = remaining.slice(codeIndex + codeMatch![0].length);
    }
  }

  return parts;
}

export default function ChangelogPage({ changelog }: ChangelogPageProps) {
  return (
    <div data-caliper-ignore>
      <div className="mb-32">
        <Link href="/" className={styles.link}>
          ← Back to Home
        </Link>
      </div>

      <div className="flex justify-center mb-20">
        <Image
          src="/caliper_logo.svg"
          alt="Caliper logo"
          width={172}
          height={50}
          className="h-auto"
          priority
          unoptimized
        />
      </div>

      <h1 className={styles.pageTitle}>{changelog.title}</h1>
      <p className={`${styles.instructionItem} mb-24`}>{changelog.description}</p>

      {changelog.versions.map((version) => (
        <div key={version.version}>
          <h2 className={`${styles.subHeader} ${styles.subHeaderPlain}`}>
            [{version.version}] — {version.date}
          </h2>

          {version.sections.map((section) => (
            <div key={section.title}>
              <h3 className={styles.subHeader}>{section.title}</h3>
              <ul className={styles.instructionList}>
                {section.items.map((item, idx) => (
                  <li key={idx} className={styles.instructionItem}>
                    - {renderInlineMarkdown(item.text)}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
