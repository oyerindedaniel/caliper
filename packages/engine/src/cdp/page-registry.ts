import {
  CALIPER_ENGINE_FOCUS_BINDING,
  CALIPER_ENGINE_METHODS,
  CALIPER_ENGINE_STATE_BINDING,
  type CaliperActionResult,
  type CaliperAgentState,
  type CaliperEngineMethod,
  type CaliperEngineOpenPagePayload,
  type CaliperEnginePageSummary,
  type CaliperEnginePageWaitUntil,
  type CaliperEngineStateSnapshot,
  type CaliperRpcRequest,
  isCaliperEngineRpcRequest,
  type CaliperEngineDefaultViewport,
} from "@oyerinde/caliper-schema";
import { CaliperAgentStateSchema } from "@oyerinde/caliper-schema";
import { pollUntil } from "@oyerinde/caliper-schema";
import { buildEngineHttpUrl, DEFAULT_ENGINE_HOST } from "@oyerinde/caliper-schema";
import type { CdpClient } from "./cdp-client.js";
import { CdpPageSession } from "./cdp-page-session.js";
import type {
  RuntimeBindingCalledEvent,
  TargetAttachedToTargetEvent,
  TargetTargetDestroyedEvent,
  TargetTargetInfoChangedEvent,
} from "./cdp-protocol.js";
import type { CdpPageTarget, RuntimeEvaluateResponse } from "./cdp-protocol.js";
import { PageHandle } from "./page-handle.js";
import type { EngineMeasurementSessionOptions } from "./engine-measurement-session.js";
import { RuntimeCaptureSession } from "./runtime-capture-session.js";
import { readEngineDefaultViewport, readEngineMaxPages } from "./engine-viewport-config.js";
import {
  cdpEventForWaitUntil,
  EngineNavigationTimeoutError,
  isEngineNavigationTimeoutError,
  resolveNavigationTimeoutMs,
} from "./navigation-timeout.js";

export type PageRegistryCallbacks = {
  onStateSnapshot?: (snapshot: CaliperEngineStateSnapshot) => void;
};

export type PageRegistryOptions = {
  debugPort: number;
  measurementOptions: EngineMeasurementSessionOptions;
  defaultViewport?: CaliperEngineDefaultViewport;
  maxPages?: number;
  initialUrl?: string | null;
  callbacks?: PageRegistryCallbacks;
};

export class PageRegistry {
  private readonly debugPort: number;
  private readonly measurementOptions: EngineMeasurementSessionOptions;
  private readonly defaultViewport: CaliperEngineDefaultViewport;
  private readonly maxPages: number;
  private readonly pages = new Map<string, PageHandle>();
  private readonly sessionToPageId = new Map<string, string>();
  private readonly pageStates = new Map<string, CaliperAgentState>();
  private readonly runtimeCapture: RuntimeCaptureSession;
  private activePageId: string | null = null;
  private stateSeq = 0;
  private started = false;
  private readonly initialUrl: string | null;
  private callbacks: PageRegistryCallbacks;
  private attachQueue: Promise<void> = Promise.resolve();
  private readonly attachFailures = new Map<string, Error>();

  constructor(
    private readonly browser: CdpClient,
    options: PageRegistryOptions
  ) {
    this.debugPort = options.debugPort;
    this.measurementOptions = options.measurementOptions;
    this.defaultViewport = options.defaultViewport ?? readEngineDefaultViewport();
    this.maxPages = options.maxPages ?? readEngineMaxPages();
    this.initialUrl = options.initialUrl ?? null;
    this.callbacks = options.callbacks ?? {};
    this.runtimeCapture = new RuntimeCaptureSession({
      projectRoot: options.measurementOptions.projectRoot,
    });
  }

  setCallbacks(callbacks: PageRegistryCallbacks): void {
    this.callbacks = callbacks;
  }

  getActivePageId(): string | null {
    return this.activePageId;
  }

  getActiveUrl(): string | null {
    const active = this.activePageId ? this.pages.get(this.activePageId) : null;
    return active?.url ?? null;
  }

  listPageSummaries(): CaliperEnginePageSummary[] {
    return [...this.pages.values()].map((page) => ({
      pageId: page.pageId,
      url: page.url,
      title: page.title,
      isActive: page.pageId === this.activePageId,
    }));
  }

  getStateSnapshot(): CaliperEngineStateSnapshot {
    const pages: Record<string, CaliperAgentState> = {};
    for (const [pageId, state] of this.pageStates.entries()) {
      pages[pageId] = { ...state, pageId };
    }

    return {
      stateSeq: this.stateSeq,
      activePageId: this.activePageId,
      pages,
    };
  }

  getDefaultViewport(): CaliperEngineDefaultViewport {
    return this.defaultViewport;
  }

  async start(): Promise<void> {
    if (this.started) {
      return;
    }
    this.started = true;

    this.browser.onEvent<TargetAttachedToTargetEvent>("Target.attachedToTarget", (event) => {
      void this.enqueueAttach(event);
    });
    this.browser.onEvent<TargetTargetInfoChangedEvent>("Target.targetInfoChanged", (event) => {
      this.updatePageInfo(event.targetInfo.targetId, event.targetInfo.url, event.targetInfo.title);
    });
    this.browser.onEvent<TargetTargetDestroyedEvent>("Target.targetDestroyed", (event) => {
      void this.removePage(event.targetId);
    });
    this.browser.onEvent<RuntimeBindingCalledEvent>("Runtime.bindingCalled", (event, sessionId) => {
      if (!sessionId) {
        return;
      }

      if (event.name === CALIPER_ENGINE_STATE_BINDING) {
        this.ingestBindingState(sessionId, event);
        return;
      }

      if (event.name === CALIPER_ENGINE_FOCUS_BINDING) {
        this.ingestBindingFocus(sessionId, event);
      }
    });

    await this.browser.send("Target.setDiscoverTargets", { discover: true });
    await this.browser.send("Target.setAutoAttach", {
      autoAttach: true,
      flatten: true,
      waitForDebuggerOnStart: false,
    });

    await pollUntil(
      async () => {
        if (this.pages.size > 0) {
          return true;
        }
        const firstFailure = this.attachFailures.values().next();
        if (!firstFailure.done) {
          throw firstFailure.value;
        }
        return null;
      },
      {
        intervalMs: 100,
        timeoutMs: 30_000,
        errorMessage: "Chrome did not attach a page target",
      }
    );

    await this.runtimeCapture.start();

    if (this.initialUrl && this.activePageId) {
      const active = this.pages.get(this.activePageId);
      if (active && shouldNavigate(active.url, this.initialUrl)) {
        await this.navigatePage(active, this.initialUrl, "load");
      }
    }
  }

  async stop(): Promise<void> {
    for (const page of [...this.pages.values()]) {
      await page.shutdown();
    }
    this.pages.clear();
    this.sessionToPageId.clear();
    this.pageStates.clear();
    await this.runtimeCapture.stop();
    await this.browser.close();
    this.started = false;
  }

  resolveCapturePath(fileName: string): string | null {
    const active = this.activePageId ? this.pages.get(this.activePageId) : null;
    return active?.measurementSession.getScreenshotSession()?.resolveCapturePath(fileName) ?? null;
  }

  async dispatch(request: CaliperRpcRequest): Promise<CaliperActionResult> {
    if (isCaliperEngineRpcRequest(request)) {
      return this.dispatchEngineMethod(request);
    }

    const page = this.resolvePage(request.params.pageId);
    return page.measurementSession.dispatchIntent(request);
  }

  private async dispatchEngineMethod(
    request: Extract<CaliperRpcRequest, { method: CaliperEngineMethod }>
  ): Promise<CaliperActionResult> {
    const timestamp = Date.now();

    switch (request.method) {
      case CALIPER_ENGINE_METHODS.LIST_PAGES:
        return {
          success: true,
          method: request.method,
          pages: this.listPageSummaries(),
          activePageId: this.activePageId,
          timestamp,
        };

      case CALIPER_ENGINE_METHODS.OPEN_PAGE:
        return this.openPage(request.params, timestamp);

      case CALIPER_ENGINE_METHODS.ACTIVATE_PAGE:
        await this.activatePage(request.params.pageId);
        return {
          success: true,
          method: request.method,
          pageId: request.params.pageId,
          timestamp,
        };

      case CALIPER_ENGINE_METHODS.CLOSE_PAGE:
        await this.closePage(request.params.pageId);
        return {
          success: true,
          method: request.method,
          pageId: request.params.pageId,
          timestamp,
        };

      case CALIPER_ENGINE_METHODS.GET_RUNTIME:
        return {
          success: true,
          method: request.method,
          fingerprint: this.runtimeCapture.getFingerprint(),
          timestamp,
        };

      case CALIPER_ENGINE_METHODS.CLEAR_RUNTIME:
        this.runtimeCapture.clear();
        return {
          success: true,
          method: request.method,
          timestamp,
        };

      default: {
        const page = this.resolvePage(request.params.pageId);
        return page.measurementSession.dispatchRpc(request);
      }
    }
  }

  private async openPage(
    params: CaliperEngineOpenPagePayload,
    timestamp: number
  ): Promise<CaliperActionResult> {
    const waitUntil = params.waitUntil ?? "domcontentloaded";

    const reuse = params.reuse ?? true;
    if (reuse) {
      const existing = this.findPageByUrl(params.url);
      if (existing) {
        await this.activatePage(existing.pageId);
        if (!urlsMatch(existing.url, params.url)) {
          try {
            await this.navigatePage(existing, params.url, waitUntil, params.timeoutMs);
          } catch (error) {
            if (isEngineNavigationTimeoutError(error)) {
              error.details.pageId = existing.pageId;
            }
            return this.openPageNavigationFailure(error, timestamp);
          }
        }
        return {
          success: true,
          method: CALIPER_ENGINE_METHODS.OPEN_PAGE,
          pageId: existing.pageId,
          url: existing.url,
          title: existing.title,
          reused: true,
          timestamp,
        };
      }
    }

    if (this.pages.size >= this.maxPages) {
      return {
        success: false,
        method: CALIPER_ENGINE_METHODS.OPEN_PAGE,
        error: `Engine page limit reached (${this.maxPages})`,
        timestamp,
      };
    }

    const created = await this.createPageTarget(params.url);
    const page = await pollUntil(
      async () => {
        const failure = this.attachFailures.get(created.id);
        if (failure) {
          throw failure;
        }
        return this.pages.get(created.id) ?? null;
      },
      {
        intervalMs: 50,
        timeoutMs: 10_000,
        errorMessage: "Timed out waiting for new page attach",
      }
    );
    await this.activatePage(page.pageId);
    try {
      await this.navigatePage(page, params.url, waitUntil, params.timeoutMs);
    } catch (error) {
      if (isEngineNavigationTimeoutError(error)) {
        error.details.pageId = page.pageId;
      }
      return this.openPageNavigationFailure(error, timestamp);
    }

    return {
      success: true,
      method: CALIPER_ENGINE_METHODS.OPEN_PAGE,
      pageId: page.pageId,
      url: page.url,
      title: page.title,
      reused: false,
      timestamp,
    };
  }

  private async createPageTarget(url: string): Promise<CdpPageTarget> {
    const response = await fetch(
      buildEngineHttpUrl(
        DEFAULT_ENGINE_HOST,
        this.debugPort,
        `/json/new?${encodeURIComponent(url)}`
      ),
      { method: "PUT" }
    );
    if (!response.ok) {
      throw new Error(`Failed to create Chrome page target (${response.status})`);
    }
    return (await response.json()) as CdpPageTarget;
  }

  private async activatePage(pageId: string): Promise<void> {
    if (!this.pages.has(pageId)) {
      throw new Error(`Unknown engine page: ${pageId}`);
    }

    const response = await fetch(
      buildEngineHttpUrl(
        DEFAULT_ENGINE_HOST,
        this.debugPort,
        `/json/activate/${encodeURIComponent(pageId)}`
      )
    );
    if (!response.ok) {
      throw new Error(`Failed to activate page ${pageId} (${response.status})`);
    }

    this.activePageId = pageId;
  }

  private async closePage(pageId: string): Promise<void> {
    if (this.pages.size <= 1) {
      throw new Error("Cannot close the last engine page");
    }
    if (!this.pages.has(pageId)) {
      throw new Error(`Unknown engine page: ${pageId}`);
    }

    await this.browser.send("Target.closeTarget", { targetId: pageId });
    await this.removePage(pageId);
  }

  private resolvePage(pageId?: string): PageHandle {
    const resolvedId = pageId ?? this.activePageId;
    if (!resolvedId) {
      throw new Error("No active engine page");
    }

    const page = this.pages.get(resolvedId);
    if (!page) {
      throw new Error(`Unknown engine page: ${resolvedId}`);
    }

    return page;
  }

  private findPageByUrl(url: string): PageHandle | null {
    for (const page of this.pages.values()) {
      if (urlsMatch(page.url, url)) {
        return page;
      }
    }
    return null;
  }

  private enqueueAttach(event: TargetAttachedToTargetEvent): Promise<void> {
    const targetId = event.targetInfo.targetId;
    const work = this.attachQueue.then(() => this.handleAttachedToTarget(event));
    this.attachQueue = work.catch((error: unknown) => {
      this.attachFailures.set(targetId, error instanceof Error ? error : new Error(String(error)));
    });
    return work;
  }

  private async handleAttachedToTarget(event: TargetAttachedToTargetEvent): Promise<void> {
    const { targetInfo, sessionId } = event;
    if (targetInfo.type !== "page" || this.pages.has(targetInfo.targetId)) {
      return;
    }

    const client = new CdpPageSession(this.browser, sessionId, targetInfo.targetId);
    const page = new PageHandle(
      targetInfo.targetId,
      client,
      targetInfo.url,
      targetInfo.title,
      this.measurementOptions,
      this.runtimeCapture,
      this.defaultViewport
    );

    try {
      await page.initialize();
    } catch (error) {
      await page.shutdown().catch(() => undefined);
      throw error;
    }

    this.pages.set(targetInfo.targetId, page);
    this.sessionToPageId.set(sessionId, targetInfo.targetId);

    if (!this.activePageId) {
      this.activePageId = targetInfo.targetId;
    }

    this.attachFailures.delete(targetInfo.targetId);
    await this.syncInitialPageFocus(page.pageId, page.client);
  }

  private async removePage(pageId: string): Promise<void> {
    const page = this.pages.get(pageId);
    if (!page) {
      return;
    }

    try {
      await page.shutdown();
    } finally {
      this.pages.delete(pageId);
      this.pageStates.delete(pageId);
      this.attachFailures.delete(pageId);

      for (const [sessionId, mappedPageId] of this.sessionToPageId.entries()) {
        if (mappedPageId === pageId) {
          this.sessionToPageId.delete(sessionId);
        }
      }

      if (this.activePageId === pageId) {
        this.activePageId = this.pages.keys().next().value ?? null;
      }
    }
  }

  private updatePageInfo(pageId: string, url: string, title: string): void {
    const page = this.pages.get(pageId);
    if (!page) {
      return;
    }
    page.url = url;
    page.title = title;
  }

  private async syncInitialPageFocus(pageId: string, client: PageHandle["client"]): Promise<void> {
    try {
      const evaluation = await client.send<RuntimeEvaluateResponse>("Runtime.evaluate", {
        expression: "document.visibilityState === 'visible'",
        returnByValue: true,
      });
      if (evaluation.result?.value !== true) {
        return;
      }
    } catch {
      return;
    }

    this.setActivePageId(pageId);
  }

  private ingestBindingFocus(sessionId: string, event: RuntimeBindingCalledEvent): void {
    const pageId = this.sessionToPageId.get(sessionId);
    if (!pageId) {
      return;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(event.payload);
    } catch {
      return;
    }

    if (!parsed || typeof parsed !== "object") {
      return;
    }

    const value = parsed as Record<string, unknown>;
    if (value.focused !== true) {
      return;
    }

    const reportedPageId = typeof value.pageId === "string" ? value.pageId : pageId;
    if (!this.pages.has(reportedPageId)) {
      return;
    }

    this.setActivePageId(reportedPageId);
  }

  private setActivePageId(pageId: string): void {
    if (pageId === this.activePageId) {
      return;
    }

    this.activePageId = pageId;
    this.stateSeq += 1;
    this.callbacks.onStateSnapshot?.(this.getStateSnapshot());
  }

  private ingestBindingState(sessionId: string, event: RuntimeBindingCalledEvent): void {
    const pageId = this.sessionToPageId.get(sessionId);
    if (!pageId) {
      return;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(event.payload);
    } catch {
      return;
    }

    const stateResult = CaliperAgentStateSchema.safeParse(parsed);
    if (!stateResult.success) {
      return;
    }

    this.pageStates.set(pageId, { ...stateResult.data, pageId });
    this.stateSeq += 1;
    this.callbacks.onStateSnapshot?.(this.getStateSnapshot());
  }

  private openPageNavigationFailure(error: unknown, timestamp: number): CaliperActionResult {
    if (isEngineNavigationTimeoutError(error)) {
      return {
        success: false,
        method: CALIPER_ENGINE_METHODS.OPEN_PAGE,
        error: error.message,
        code: error.code,
        details: error.details,
        timestamp,
      };
    }

    return {
      success: false,
      method: CALIPER_ENGINE_METHODS.OPEN_PAGE,
      error: error instanceof Error ? error.message : String(error),
      timestamp,
    };
  }

  private async navigatePage(
    page: PageHandle,
    url: string,
    waitUntil: CaliperEnginePageWaitUntil,
    timeoutMsOverride?: number
  ): Promise<void> {
    const timeoutMs = resolveNavigationTimeoutMs(waitUntil, timeoutMsOverride);
    const cdpEvent = cdpEventForWaitUntil(waitUntil);
    const startedAt = Date.now();

    const waitPromise = page.client.waitForEvent(cdpEvent, timeoutMs);
    await page.client.send("Page.navigate", { url });

    try {
      await waitPromise;
    } catch {
      throw new EngineNavigationTimeoutError({
        url,
        waitUntil,
        timeoutMs,
        elapsedMs: Date.now() - startedAt,
        cdpEvent,
      });
    }

    page.url = url;
  }
}

function shouldNavigate(currentUrl: string, targetUrl: string): boolean {
  if (currentUrl === "about:blank") {
    return true;
  }
  return !urlsMatch(currentUrl, targetUrl);
}

function urlsMatch(left: string, right: string): boolean {
  try {
    return new URL(left).href === new URL(right).href;
  } catch {
    return left === right;
  }
}
