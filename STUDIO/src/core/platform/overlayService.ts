/**
 * overlayService — manages the always-on floating island overlay window.
 *
 * Architecture:
 *   - Creates ONE frameless transparent Tauri window at app startup (init())
 *   - Window stays alive for the entire app session — no create/destroy per use
 *   - Communicates exclusively via cross-webview Tauri events:
 *       main → overlay : "studio:overlay-update"  (IslandPayload)
 *       overlay → main : "studio:overlay-action"  (OverlayAction)
 *
 * States:
 *   IDLE      — tiny breathing pill (opacity = user's overlayOpacity setting)
 *   RECORDING — expanded, waveform visible
 *   PROCESSING/TRANSCRIBING/REPHRASING — expanded, spinner
 *   COMPLETE  — expanded, transcript + action buttons
 *   ERROR     — expanded, error indicator
 *   HIDDEN    — island is slid above the screen (fully out of view)
 */

import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { emitTo } from "@tauri-apps/api/event";
import { RecordingState } from "../../types";
import type { PulseCard } from "../../types/pulse";
import type { VoiceCaptionState } from "../../hooks/useLiveSession";
import { featureManager } from "./featureManager";
import { logger } from "../logging/logger";

// ─── Public types ────────────────────────────────────────────────────────────

export type IslandMode = "global" | "voice" | "transcription" | "artifact";

export interface OverlayPayload {
  state: RecordingState;
  /**
   * "transcription" (default) — hotkey recording flow, paste to cursor.
   * "voice" — live voice session; COMPLETE state shows AI response text.
   */
  mode?: IslandMode;
  transcript?: string;
  rephrased?: string;
  autoRephrase?: boolean;
  /** AI response text shown when mode="voice" and state=COMPLETE (AI speaking). */
  aiText?: string;
  /** Current spoken sentence and approximate word index during live TTS playback. */
  voiceCaption?: VoiceCaptionState;
  /** Island idle-state opacity 0–100. Forwarded from user settings. */
  opacity?: number;
  /** Real microphone levels (5 values 0–1) for live waveform visualization. */
  audioLevels?: number[];
  /**
   * Pulse card payload. When set and state=COMPLETE, the card view is rendered
   * instead of the default transcription complete UI.
   */
  card?: PulseCard;
}

export type OverlayActionType =
  | "copy"
  | "expand"
  | "new"
  | "dismiss"
  | "focus"
  | "startVoice"
  | "startTranscription"
  | "openChat";

export interface OverlayAction {
  action: OverlayActionType;
  text?: string;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const OVERLAY_LABEL = "overlay";

// Fixed window size — wide enough for the complete state, tall enough for
// the slide-in animation. The window background is transparent so the extra
// space is invisible.
const WIN_WIDTH = 440;
const WIN_ABOVE_SCREEN = 0;   // legacy export; overlay is now positioned on-screen
const CAPSULE_H = 68;         // tallest state (complete)
const WIN_HEIGHT = 8 + CAPSULE_H + 8;

/** Extra ms to let React mount before sending the first event */
const MOUNT_DELAY_MS = 200;

// ─── Service ─────────────────────────────────────────────────────────────────

class OverlayService {
  private win: WebviewWindow | null = null;
  private creating = false;
  private pendingPayload: OverlayPayload | null = null;
  /** Last opacity received so returnToIdle() can restore it without a caller ref. */
  private lastOpacity: number = 70;
  /** When false, all show/update calls are no-ops and the island is hidden. */
  private islandEnabled: boolean = true;

  // ── Public API ─────────────────────────────────────────────────────────────

  /**
   * Enable or disable the Pulse island.
   * Disabling immediately slides it above the screen; enabling re-inits to idle.
   */
  setEnabled(enabled: boolean): void {
    this.islandEnabled = enabled;
    if (!enabled) {
      this._send({ state: RecordingState.IDLE, mode: "global", opacity: 0 }).catch(() => null);
    }
  }

  /**
   * Create or re-attach to the overlay window at app startup and reset to idle.
   * Safe to call multiple times — re-uses the existing window but always sends
   * the idle state so the island reflects the current opacity/mode setting.
   *
   * @param idleOpacity  0–100 idle-pill opacity
   * @param isDark       When provided, syncs the app theme to the overlay right
   *                     after the window is confirmed ready. This fixes the race
   *                     where the regular studio:overlay-theme event fires before
   *                     the overlay window exists and gets silently dropped.
   */
  async init(idleOpacity: number = 70, isDark?: boolean): Promise<void> {
    if (!featureManager.isEnabled("titleBar")) return;
    if (!this.islandEnabled) return;
    if (this.creating) return;

    // Window already exists — skip creation, just update idle state + theme.
    // This handles re-init from settings changes (opacity / enabled toggle) without
    // risking a second window. The creating guard above covers the concurrent-call race.
    if (this.win) {
      await this._send({ state: RecordingState.IDLE, mode: "global", opacity: idleOpacity });
      if (isDark !== undefined) {
        try { await emitTo(OVERLAY_LABEL, "studio:overlay-theme", { dark: isDark }); } catch { /* not fatal */ }
      }
      return;
    }

    await this._getOrCreateWindow();
    await this._send({ state: RecordingState.IDLE, mode: "global", opacity: idleOpacity });

    // Guaranteed delivery: window is confirmed ready + MOUNT_DELAY_MS at this point
    if (isDark !== undefined) {
      try {
        await emitTo(OVERLAY_LABEL, "studio:overlay-theme", { dark: isDark });
      } catch {
        // Window already gone — not fatal
      }
    }
  }

  /**
   * Show or update the island with a new state.
   * Creates the window on first use if init() was not called.
   */
  async show(payload: OverlayPayload): Promise<void> {
    if (!featureManager.isEnabled("titleBar")) return;
    if (!this.islandEnabled) return;

    if (this.win) {
      await this._send(payload);
      return;
    }

    if (this.creating) {
      this.pendingPayload = payload;
      return;
    }

    await this._getOrCreateWindow();
    await this._send(payload);
  }

  /**
   * Send a state update without creating the window.
   * No-op if the window is not open or Pulse is disabled.
   */
  async update(payload: OverlayPayload): Promise<void> {
    if (!this.islandEnabled) return;
    if (this.win) {
      await this._send(payload);
    }
  }

  /**
   * Transition island to IDLE state (tiny pill, no dismiss).
   * Does NOT close the window — the island stays on screen as the idle dot.
   * Uses the last known opacity if none is provided (safe from stale closures).
   */
  async returnToIdle(opacity?: number, mode: IslandMode = "global"): Promise<void> {
    if (!this.islandEnabled) return;
    await this._send({ state: RecordingState.IDLE, mode, opacity: opacity ?? this.lastOpacity });
  }

  /**
   * Push a typed Pulse card to the overlay.
   * Any Studio feature (MCP tools, image gen, web search, etc.) can call this
   * to display a rich result card without touching recording state.
   */
  async showCard(card: PulseCard): Promise<void> {
    if (!featureManager.isEnabled("titleBar")) return;
    if (!this.islandEnabled) return;
    await this.show({ state: RecordingState.COMPLETE, mode: "artifact", card, opacity: this.lastOpacity });
  }

  /**
   * Clear the active card and return the island to idle.
   */
  async clearCard(): Promise<void> {
    await this.returnToIdle();
  }

  /**
   * Slide the island above the screen (fully hidden).
   * The window stays alive — call show() / init() to bring it back.
   */
  async hide(): Promise<void> {
    // Slide island above screen by sending opacity=0 with IDLE state
    await this._send({ state: RecordingState.IDLE, mode: "global", opacity: 0 });
  }

  /** Force-close the overlay window entirely. */
  async close(): Promise<void> {
    if (!this.win) return;
    try {
      await this.win.close();
    } catch {
      // Already closed
    }
    this.win = null;
  }

  isOpen(): boolean {
    return this.win !== null;
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private async _getOrCreateWindow(): Promise<void> {
    // Set creating=true SYNCHRONOUSLY before any await so that concurrent
    // callers (e.g. two effects firing on the same mount) see the flag and
    // bail out via the init() guard, preventing duplicate window creation.
    this.creating = true;

    // Re-attach if already exists (e.g. app hot-reload without full close)
    try {
      const existing = await WebviewWindow.getByLabel(OVERLAY_LABEL);
      if (existing) {
        this.win = existing;
        this.creating = false;
        // Wire up destroy handler so win is nulled if the re-attached window closes
        existing.once("tauri://destroyed", () => {
          logger.debug("OverlayService", "Re-attached overlay window destroyed");
          this.win = null;
          this.creating = false;
        });
        return;
      }
    } catch {
      // getByLabel may throw on some Tauri versions — treat as not found
    }

    try {
      const win = new WebviewWindow(OVERLAY_LABEL, {
        url: "/?w=overlay",
        title: "",
        x: 0,
        y: 0,
        width: WIN_WIDTH,
        height: WIN_HEIGHT,
        decorations: false,
        transparent: true,
        alwaysOnTop: true,
        skipTaskbar: true,
        resizable: false,
        focus: false,
        shadow: false,
        // Hidden until OverlayPage positions and reveals it — eliminates the
        // "full-window flash at (0,0)" artifact seen on every app launch.
        visible: false,
      });

      this.win = win;

      await new Promise<void>((resolve) => {
        win.once("tauri://created", async () => {
          logger.debug("OverlayService", "Overlay window created");
          this.creating = false;
          await new Promise((r) => setTimeout(r, MOUNT_DELAY_MS));
          await this._flushPending();
          resolve();
        });

        win.once("tauri://error", (e) => {
          logger.error("OverlayService", "Overlay window creation failed", e);
          this.creating = false;
          this.win = null;
          resolve();
        });
      });

      win.once("tauri://destroyed", () => {
        logger.debug("OverlayService", "Overlay window destroyed");
        this.win = null;
        this.creating = false;
      });
    } catch (err) {
      logger.error("OverlayService", "Failed to create overlay window", err);
      this.creating = false;
      this.win = null;
    }
  }

  private async _send(payload: OverlayPayload): Promise<void> {
    if (payload.opacity !== undefined) {
      this.lastOpacity = payload.opacity;
    }
    try {
      await emitTo(OVERLAY_LABEL, "studio:overlay-update", payload);
    } catch (err) {
      logger.warn("OverlayService", "Failed to send overlay event", err);
      this.win = null;
    }
  }

  private async _flushPending(): Promise<void> {
    if (this.pendingPayload) {
      const p = this.pendingPayload;
      this.pendingPayload = null;
      await this._send(p);
    }
  }
}

export const overlayService = new OverlayService();
// Expose window sizing for OverlayPage (must match)
export const OVERLAY_WIN_WIDTH = WIN_WIDTH;
export const OVERLAY_WIN_HEIGHT = WIN_HEIGHT;
export const OVERLAY_WIN_ABOVE_SCREEN = WIN_ABOVE_SCREEN;
