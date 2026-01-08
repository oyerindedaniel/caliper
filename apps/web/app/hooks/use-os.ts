import { useState, useEffect } from "react";

export function useOS() {
    const [isMac, setIsMac] = useState(false);

    useEffect(() => {
        const platform =
            // @ts-ignore
            navigator.userAgentData?.platform ||
            navigator.userAgent;

        setIsMac(/Mac|iPod|iPhone|iPad/.test(platform));
    }, []);

    return {
        isMac,
        getControlKey: () => (isMac ? "⌘" : "Ctrl"),
        getSelectKey: () => (isMac ? "Command" : "Control"),
    };
}
