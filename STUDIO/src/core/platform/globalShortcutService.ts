/**
 * Global Shortcut Service
 *
 * Manages OS-level global keyboard shortcuts via Tauri's global-shortcut plugin.
 * Emits "global-shortcut-triggered" when the shortcut fires.
 *
 * Registration strategy:
 *   Always try to unregister first (ignoring errors), then register fresh.
 *   This avoids the isRegistered() race condition that occurs when React
 *   StrictMode runs effects twice: the async unregister from cleanup can
 *   still be in-flight when the remount tries to re-register, causing
 *   isRegistered() to return stale true and producing conflicting concurrent
 *   unregister calls that leave the shortcut permanently broken.
 */

import { isFeatureEnabled } from "./featureManager";
import { logger } from "../logging/logger";

let currentShortcut: string | null = null;
let registeringPromise: Promise<boolean> | null = null;

let currentVoiceShortcut: string | null = null;
let registeringVoicePromise: Promise<boolean> | null = null;

function keysToShortcut(keys: string[]): string {
  return keys
    .map((key) => {
      const k = key.toLowerCase();
      if (k === "ctrl" || k === "control") return "Ctrl";
      if (k === "shift") return "Shift";
      if (k === "alt") return "Alt";
      if (k === "meta" || k === "cmd") return "Super";
      return key.toUpperCase();
    })
    .join("+");
}

export async function registerGlobalShortcut(keys: string[]): Promise<boolean> {
  if (!isFeatureEnabled("globalShortcuts")) {
    logger.debug("GlobalShortcut", `Not supported on this platform`);
    return false;
  }

  if (!keys || keys.length === 0) {
    logger.warn("GlobalShortcut", "Empty keys array — skipping registration");
    return false;
  }

  const shortcut = keysToShortcut(keys);

  // Serialize concurrent registration calls
  if (registeringPromise) {
    return registeringPromise;
  }

  registeringPromise = (async (): Promise<boolean> => {
    try {
      const { register, unregister } = await import("@tauri-apps/plugin-global-shortcut");
      const { emit } = await import("@tauri-apps/api/event");

      // Unregister whatever is currently tracked
      if (currentShortcut) {
        try {
          await unregister(currentShortcut);
        } catch {
          // Already gone — that's fine
        }
        currentShortcut = null;
      }

      // Always attempt to clear any residual OS registration for this shortcut
      // (handles leftover state from previous sessions or StrictMode remounts)
      try {
        await unregister(shortcut);
      } catch {
        // Not registered — that's fine
      }

      await register(shortcut, async (event) => {
        // Tauri v2 fires on both Pressed (keydown) and Released (keyup).
        // Ignore keyup so one tap = one trigger, not start→immediate-stop.
        if (event.state === "Released") return;
        logger.debug("GlobalShortcut", `Triggered: ${shortcut}`);
        await emit("global-shortcut-triggered", { shortcut });
      });

      currentShortcut = shortcut;
      logger.debug("GlobalShortcut", `Registered: ${shortcut}`);
      return true;
    } catch (error) {
      logger.error("GlobalShortcut", "Failed to register", error);
      return false;
    } finally {
      registeringPromise = null;
    }
  })();

  return registeringPromise;
}

export async function unregisterGlobalShortcut(): Promise<void> {
  if (!currentShortcut) return;

  // Clear immediately so a concurrent registerGlobalShortcut call won't
  // think there's still a valid registration to skip over.
  const toUnregister = currentShortcut;
  currentShortcut = null;

  if (!isFeatureEnabled("globalShortcuts")) return;

  try {
    const { unregister } = await import("@tauri-apps/plugin-global-shortcut");
    await unregister(toUnregister);
    logger.debug("GlobalShortcut", `Unregistered: ${toUnregister}`);
  } catch (error) {
    logger.error("GlobalShortcut", "Failed to unregister", error);
  }
}

/**
 * Register the voice-mode global shortcut.
 * Emits "voice-shortcut-triggered" when fired (separate from recording shortcut).
 * Uses the same serialization-safe pattern as registerGlobalShortcut.
 */
export async function registerVoiceShortcut(keys: string[]): Promise<boolean> {
  if (!isFeatureEnabled("globalShortcuts")) {
    return false;
  }

  // Empty array = voice shortcut disabled — unregister any leftover and bail
  if (!keys || keys.length === 0) {
    await unregisterVoiceShortcut();
    return true;
  }

  const shortcut = keysToShortcut(keys);

  if (registeringVoicePromise) {
    return registeringVoicePromise;
  }

  registeringVoicePromise = (async (): Promise<boolean> => {
    try {
      const { register, unregister } = await import("@tauri-apps/plugin-global-shortcut");
      const { emit } = await import("@tauri-apps/api/event");

      // Unregister whatever is currently tracked
      if (currentVoiceShortcut) {
        try { await unregister(currentVoiceShortcut); } catch { /* gone already */ }
        currentVoiceShortcut = null;
      }

      // Clear any residual OS registration for this specific shortcut
      try { await unregister(shortcut); } catch { /* not registered */ }

      await register(shortcut, async (event) => {
        // Tauri v2 fires on both Pressed AND Released — ignore keyup
        if (event.state === "Released") return;
        logger.debug("GlobalShortcut", `Voice triggered: ${shortcut}`);
        await emit("voice-shortcut-triggered", { shortcut });
      });

      currentVoiceShortcut = shortcut;
      logger.debug("GlobalShortcut", `Voice registered: ${shortcut}`);
      return true;
    } catch (error) {
      logger.error("GlobalShortcut", "Failed to register voice shortcut", error);
      return false;
    } finally {
      registeringVoicePromise = null;
    }
  })();

  return registeringVoicePromise;
}

export async function unregisterVoiceShortcut(): Promise<void> {
  if (!currentVoiceShortcut) return;

  const toUnregister = currentVoiceShortcut;
  currentVoiceShortcut = null;

  if (!isFeatureEnabled("globalShortcuts")) return;

  try {
    const { unregister } = await import("@tauri-apps/plugin-global-shortcut");
    await unregister(toUnregister);
    logger.debug("GlobalShortcut", `Voice unregistered: ${toUnregister}`);
  } catch (error) {
    logger.error("GlobalShortcut", "Failed to unregister voice shortcut", error);
  }
}
