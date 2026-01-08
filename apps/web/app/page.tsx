"use client";

import Image from "next/image";
import styles from "./page.module.css";
import { CommandTable } from "./command";
import { Installation } from "./installation";
import { Configuration } from "./configuration";
import { Configurator } from "./configurator";
import { Instructions } from "./instructions";

export default function Home() {
  return (
    <div className={styles.page}>
      <main className={styles.main}>
        <Image
          className="imgDark"
          src="/caliper_logo.svg"
          alt="Caliper logo"
          width={171.5}
          height={50}
          priority
          unoptimized
        />
        <p>Essential tooling for detail-obsessed design engineer.</p>

        <Installation />
        <Configuration />
        <Configurator />
        <Instructions />
        <CommandTable />
      </main>
      <footer className={styles.footer}>
        <a
          href="https://github.com/oyerindedaniel/caliper"
          target="_blank"
          rel="noopener noreferrer"
        >
          Github
        </a>
        <a
          href="https://danieloyerinde.com"
          target="_blank"
          rel="noopener noreferrer"
        >
          <Image
            aria-hidden
            src="/globe.svg"
            alt="Globe icon"
            width={16}
            height={16}
          />
          Daniel Oyerinde →
        </a>
      </footer>
    </div>
  );
}
