"use client";
import type { OverlayInstance } from "@oyerinde/caliper";
import { useEffect } from "react";
import { useConfig } from "./contexts/config-context";

declare global {
  interface Window {
    __CALIPER__?: OverlayInstance;
    __CALIPER_IS_BOOTED__?: boolean;
  }
}

export function CaliperWrapper() {
  const { getCaliperConfig } = useConfig();
  const config = getCaliperConfig();
  const configHash = JSON.stringify(config);

  useEffect(() => {
    const caliper = window.__CALIPER__;
    if (!caliper) return;

    if (window.__CALIPER_IS_BOOTED__) {
      console.log("Mounting caliper");
      caliper.mount();
    }

    if (config.theme?.primary && config.theme?.secondary) {
      document.documentElement.style.setProperty("--caliper-primary", config.theme.primary);
      document.documentElement.style.setProperty("--caliper-secondary", config.theme.secondary);
    }

    window.__CALIPER_IS_BOOTED__ = true;
    console.log("Caliper is booted");

    return () => {
      caliper.dispose();
    };
  }, [configHash]);

  return null;
}
