"use client";

import Image from "next/image";
import styles from "./page.module.css";
import { CommandTable } from "./command";
import { Installation } from "./installation";
import { Configuration } from "./configuration";
import { Configurator } from "./configurator";
import { Instructions } from "./instructions";
import { TryCaliper } from "./try-caliper";
import { Footer } from "./components/footer";
import { FocusProvider } from "./contexts/focus-context";
import { Nav } from "./components/nav";
import { OnThisPage } from "./components/on-this-page";

export default function HomePage() {
  return (
    <FocusProvider>
      <div className={styles.page}>
        <main className={styles.main}>
          <Nav />
          <div className="flex flex-col gap-12">
            <Image
              src="/caliper_logo.svg"
              alt="Caliper logo"
              width={172}
              height={50}
              className="h-auto"
              priority
              unoptimized
            />
            <p>
              Essential tooling for detail-obsessed design engineers. High-precision browser
              measurements, projections, and layout auditing.
            </p>
          </div>

          <Installation />
          <TryCaliper />
          <Configuration />
          <Instructions />
          <CommandTable />
          <Configurator />
        </main>
        <OnThisPage />
        <Footer />
      </div>
    </FocusProvider>
  );
}
