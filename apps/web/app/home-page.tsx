"use client";

import Image from "next/image";
import { CommandTable } from "./command";
import { Installation } from "./installation";
import { Configuration } from "./configuration";
import { Configurator } from "./configurator";
import { Instructions } from "./instructions";
import { TryCaliper } from "./try-caliper";

export default function HomePage() {
  return (
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

      <Installation />
      <TryCaliper />
      <Configuration />
      <Instructions />
      <CommandTable />
      <Configurator />
    </div>
  );
}
