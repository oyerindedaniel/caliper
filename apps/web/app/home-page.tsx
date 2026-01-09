"use client";

import Image from "next/image";
import styles from "./page.module.css";
import { CommandTable } from "./command";
import { Installation } from "./installation";
import { Configuration } from "./configuration";
import { Configurator } from "./configurator";
import { Instructions } from "./instructions";
import { TryCaliper } from "./try-caliper";
import { Footer } from "./footer";
import { FocusProvider } from "./context";

export default function HomePage() {
    return (
        <FocusProvider>
            <div className={styles.page}>
                <main className={styles.main}>
                    <Image
                        src="/caliper_logo.svg"
                        alt="Caliper logo"
                        width={171.5}
                        height={50}
                        priority
                        unoptimized
                    />
                    <p>Essential tooling for detail-obsessed design engineers. High-precision browser measurements, projections, and layout auditing.</p>

                    <Installation />
                    <TryCaliper />
                    <Configuration />
                    <Instructions />
                    <CommandTable />
                    <Configurator />
                </main>
                <Footer />
            </div>
        </FocusProvider>
    );
}
