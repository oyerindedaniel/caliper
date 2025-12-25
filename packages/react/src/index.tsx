import React, { useEffect, useRef, createContext, useContext } from "react";
import { createOverlay, type OverlayInstance } from "@caliper/overlay";
import type { OverlayConfig } from "@caliper/core";

export interface UseCaliperOptions {
  enabled?: boolean;
  config?: OverlayConfig;
}

interface CaliperContextValue {
  instance: OverlayInstance | null;
  config: OverlayConfig | undefined;
}

const CaliperContext = createContext<CaliperContextValue | null>(null);

export function CaliperProvider({
  children,
  config,
  enabled = true,
}: {
  children: React.ReactNode;
  config?: OverlayConfig;
  enabled?: boolean;
}) {
  const instanceRef = useRef<OverlayInstance | null>(null);

  useEffect(() => {
    if (!enabled) return;

    const instance = createOverlay(config);
    instanceRef.current = instance;
    instance.mount();

    return () => {
      instance.dispose();
      instanceRef.current = null;
    };
  }, [enabled, config]);

  const value: CaliperContextValue = {
    instance: instanceRef.current,
    config,
  };

  return React.createElement(CaliperContext.Provider, { value }, children);
}

export function useCaliper(options: UseCaliperOptions = {}) {
  const context = useContext(CaliperContext);
  const instanceRef = useRef<OverlayInstance | null>(null);

  useEffect(() => {
    if (options.enabled === false) return;

    if (context?.instance) {
      instanceRef.current = context.instance;
      return;
    }

    const instance = createOverlay(options.config);
    instanceRef.current = instance;
    instance.mount();

    return () => {
      instance.dispose();
      instanceRef.current = null;
    };
  }, [options.enabled, options.config, context?.instance]);

  return instanceRef.current;
}
