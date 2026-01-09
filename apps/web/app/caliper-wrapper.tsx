"use client";

import { useEffect } from "react";
import { init } from "@oyerinde/caliper";

export function CaliperWrapper() {
    useEffect(() => {
        const caliper = init({
            theme: {
                primary: "#ff00ff",
                secondary: "#00ffff",
            },
            commands: {
                activate: "Alt",
                calculator: {
                    top: "u",
                }
            }
        });

        console.log("Caliper initialized from package", caliper);

        return () => {
            caliper.dispose();
        };
    }, []);

    return null;
}
