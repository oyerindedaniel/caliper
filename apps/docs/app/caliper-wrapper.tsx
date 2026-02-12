"use client";

import { useEffect } from "react";
import { init } from "@oyerinde/caliper/preset";
import { CaliperBridge } from "@oyerinde/caliper/bridge";

export function CaliperWrapper() {
  useEffect(() => {
    init({}, [
      CaliperBridge({
        enabled: true,
        wsPort: 3010,
      }),
    ]);
  }, []);

  return null;
}
