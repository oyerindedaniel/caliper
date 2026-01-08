const IS_BROWSER = typeof window !== "undefined";

const getPlatform = () => {
    if (!IS_BROWSER) return "";

    // Modern approach (User-Agent Client Hints API)
    // @ts-ignore - userAgentData is not in all lib.dom.d.ts versions yet
    if (navigator.userAgentData?.platform) {
        // @ts-ignore
        return navigator.userAgentData.platform;
    }

    // Fallback approach (userAgent scanning is more reliable than deprecated .platform)
    return navigator.userAgent;
};

const IS_MAC = IS_BROWSER && /Mac|iPod|iPhone|iPad/.test(getPlatform());

export const OS = {
    IS_BROWSER,
    IS_MAC,
    getControlKey: () => (IS_MAC ? "Meta" : "Control"),
};
