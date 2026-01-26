import { WebSocket } from "ws";
import { createLogger } from "../utils/logger.js";

const logger = createLogger("tab-manager");

export interface ConnectedTab {
  id: string;
  ws: WebSocket;
  url: string;
  title: string;
  isFocused: boolean;
  lastActive: number;
}

export class TabManager {
  private tabs = new Map<string, ConnectedTab>();
  private activeTabId: string | null = null;

  registerTab(tab: Omit<ConnectedTab, "lastActive">) {
    this.tabs.set(tab.id, {
      ...tab,
      lastActive: Date.now(),
    });
    this.activeTabId = tab.id;
    logger.info(`Tab registered: ${tab.title} (${tab.id})`);
  }

  updateTab(id: string, isFocused: boolean) {
    const tab = this.tabs.get(id);
    if (tab) {
      tab.lastActive = Date.now();
      if (isFocused) {
        this.activeTabId = id;
      }
    }
  }

  removeTab(id: string, ws: WebSocket) {
    const tab = this.tabs.get(id);
    if (tab && tab.ws === ws) {
      this.tabs.delete(id);
      if (this.activeTabId === id) {
        this.activeTabId = Array.from(this.tabs.keys())[0] || null;
      }
      logger.info(`Tab disconnected: ${id}`);
    }
  }

  getActiveTab(): ConnectedTab | null {
    if (!this.activeTabId) return null;
    return this.tabs.get(this.activeTabId) || null;
  }

  getTabById(id: string): ConnectedTab | null {
    return this.tabs.get(id) || null;
  }

  getAllTabs(): ConnectedTab[] {
    return Array.from(this.tabs.values());
  }

  switchTab(id: string): boolean {
    if (this.tabs.has(id)) {
      this.activeTabId = id;
      return true;
    }
    return false;
  }

  getTabCount(): number {
    return this.tabs.size;
  }

  findTabByUrl(urlFragment: string): ConnectedTab | null {
    for (const tab of this.tabs.values()) {
      if (tab.url.includes(urlFragment)) {
        return tab;
      }
    }
    return null;
  }
}

export const tabManager = new TabManager();
