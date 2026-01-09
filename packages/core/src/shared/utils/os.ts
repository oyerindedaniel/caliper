const IS_BROWSER = typeof window !== "undefined";

type OS = "macos" | "ios" | "windows" | "android" | "linux" | "other";

function detectOS(): OS {
    if (!IS_BROWSER) return "other";

    // @ts-ignore
    const platform = navigator.userAgentData?.platform;
    if (platform) {
        switch (platform) {
            case "macOS":
                return "macos";
            case "iOS":
                return "ios";
            case "Windows":
                return "windows";
            case "Android":
                return "android";
            case "Linux":
                return "linux";
        }
    }

    const ua = navigator.userAgent;

    if (/iPhone|iPad|iPod/.test(ua)) return "ios";
    if (/Macintosh/.test(ua)) return "macos";
    if (/Windows/.test(ua)) return "windows";
    if (/Android/.test(ua)) return "android";
    if (/Linux/.test(ua)) return "linux";

    return "other";
}

const OS_NAME = detectOS();
const IS_APPLE = OS_NAME === "macos" || OS_NAME === "ios";

export const OS = {
    IS_BROWSER,
    NAME: OS_NAME,

    IS_MAC: OS_NAME === "macos",
    IS_IOS: OS_NAME === "ios",
    IS_APPLE,

    getControlKey: () => (IS_APPLE ? "Meta" : "Control"),
};
