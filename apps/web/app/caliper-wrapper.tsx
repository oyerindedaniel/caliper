"use client";

import { useEffect } from "react";
import { init } from "@oyerinde/caliper";
import { useConfig } from "./config-context";

export function CaliperWrapper() {
    const { getCaliperConfig } = useConfig();
    const config = getCaliperConfig();
    const configHash = JSON.stringify(config);

    useEffect(() => {
        const caliper = init(config);

        return () => {
            caliper.dispose();
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [configHash]);

    return null;
}
