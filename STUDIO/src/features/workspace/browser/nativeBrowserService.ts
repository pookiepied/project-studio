import { invoke } from "@tauri-apps/api/core";
import { environmentService } from "@/services/platform/environmentService";

export interface NativeBrowserBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

const labelForTab = (tabId: string) => `studio-browser-${tabId}`;

function isAvailable() {
  return environmentService.isTauri();
}

async function call(command: string, args: Record<string, unknown>) {
  if (!isAvailable()) return;
  await invoke(command, args);
}

export const nativeBrowserService = {
  isAvailable,
  labelForTab,

  async create(tabId: string, url: string, bounds: NativeBrowserBounds) {
    await call("native_browser_create", {
      label: labelForTab(tabId),
      url,
      ...bounds,
    });
  },

  async setBounds(tabId: string, bounds: NativeBrowserBounds) {
    await call("native_browser_set_bounds", {
      label: labelForTab(tabId),
      ...bounds,
    });
  },

  async show(tabId: string) {
    await call("native_browser_show", { label: labelForTab(tabId) });
  },

  async hide(tabId: string) {
    await call("native_browser_hide", { label: labelForTab(tabId) });
  },

  async close(tabId: string) {
    await call("native_browser_close", { label: labelForTab(tabId) });
  },

  async navigate(tabId: string, url: string) {
    await call("native_browser_navigate", { label: labelForTab(tabId), url });
  },

  async reload(tabId: string) {
    await call("native_browser_reload", { label: labelForTab(tabId) });
  },

  async back(tabId: string) {
    await call("native_browser_back", { label: labelForTab(tabId) });
  },

  async forward(tabId: string) {
    await call("native_browser_forward", { label: labelForTab(tabId) });
  },

  async setZoom(tabId: string, zoom: number) {
    await call("native_browser_set_zoom", { label: labelForTab(tabId), zoom });
  },

  async clearData(tabId: string) {
    await call("native_browser_clear_data", { label: labelForTab(tabId) });
  },
};
