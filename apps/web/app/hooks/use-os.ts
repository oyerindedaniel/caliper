import { useState, useEffect } from "react";

type OS = "mac" | "ios" | "windows" | "other";

export function useOS() {
  const [os, setOS] = useState<OS>("other");

  useEffect(() => {
    if (typeof window === "undefined") return;

    // @ts-ignore
    const platform = navigator.userAgentData?.platform;

    if (platform === "macOS") {
      setOS("mac");
      return;
    }

    if (platform === "iOS") {
      setOS("ios");
      return;
    }

    if (platform === "Windows") {
      setOS("windows");
      return;
    }

    const ua = navigator.userAgent;

    if (/iPhone|iPad|iPod/.test(ua)) {
      setOS("ios");
    } else if (/Macintosh/.test(ua)) {
      setOS("mac");
    } else if (/Windows/.test(ua)) {
      setOS("windows");
    }
  }, []);

  const isApple = os === "mac" || os === "ios";

  return {
    os,
    getControlKey: () => (isApple ? "⌘" : "Ctrl"),
    getSelectKey: () => (isApple ? "Command" : "Control"),
    getAltKey: () => (isApple ? "Option" : "Alt"),
  };
}
