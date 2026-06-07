/** Inline expression: ensure overlay state can reach the engine CDP binding. */
export const INSTALL_ENGINE_STATE_REPORTER_EXPRESSION = `(function () {
  if (typeof window.__CALIPER_ENGINE_REPORT_STATE__ === "function") {
    return;
  }
  window.__CALIPER_ENGINE_REPORT_STATE__ = function (state) {
    if (typeof window.caliperEngineState === "function") {
      window.caliperEngineState(JSON.stringify(state));
    }
  };
})();`;

/** Current-document prep: engine owns transport; reporter must exist before foreign bridge emits state. */
export const PREPARE_ENGINE_MANAGED_PAGE_EXPRESSION = `window.__CALIPER_ENGINE_MANAGED__ = true;
${INSTALL_ENGINE_STATE_REPORTER_EXPRESSION}`;

/** Tears down MCP relay on a page bridge that started before engine-managed mode applied. */
export const APPLY_ENGINE_MANAGED_TRANSPORT_EXPRESSION = `(function () {
  if (typeof window.__CALIPER_ENGINE_APPLY_MANAGED_TRANSPORT__ === "function") {
    window.__CALIPER_ENGINE_APPLY_MANAGED_TRANSPORT__();
  }
})();`;

export function buildEngineFocusListenerExpression(pageId: string): string {
  return `(function () {
    if (window.__CALIPER_ENGINE_FOCUS_LISTENER_INSTALLED__) {
      return;
    }
    window.__CALIPER_ENGINE_FOCUS_LISTENER_INSTALLED__ = true;
    const pageId = ${JSON.stringify(pageId)};
    const report = function () {
      if (document.visibilityState !== "visible") {
        return;
      }
      if (typeof window.caliperEngineFocus === "function") {
        window.caliperEngineFocus(JSON.stringify({ pageId: pageId, focused: true }));
      }
    };
    window.addEventListener("focus", report, true);
    document.addEventListener("visibilitychange", report);
    report();
  })();`;
}
