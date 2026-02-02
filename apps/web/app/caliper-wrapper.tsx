"use client";

import { useEffect } from "react";
import { init } from "@oyerinde/caliper";
import { CaliperBridge } from "@oyerinde/caliper-bridge";
import { useConfig } from "./contexts/config-context";

export function CaliperWrapper() {
  const { getCaliperConfig } = useConfig();
  const config = getCaliperConfig()
  const configHash = JSON.stringify(config);

  useEffect(() => {
    const caliper = init(config);
    if (config.theme?.primary) {
      document.documentElement.style.setProperty("--caliper-primary", config.theme.primary);
    }

    caliper.use(
      CaliperBridge({
        enabled: true,
      })
    );

    return () => {
      caliper.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [configHash]);

  return null;
}
