/**
 * GlobalShortcutHandler
 *
 * Always-mounted headless component that owns:
 *   • Recording shortcut registration (Ctrl+Shift+R by default)
 *   • Voice shortcut registration (Ctrl+Shift+V by default)
 *   • Pulse overlay lifecycle (init, theme sync, state sync)
 *   • Overlay action routing (copy / expand / new / dismiss / focus)
 *
 * Rendered once inside HomePage, above all pages, so it survives view changes.
 * All event listeners read live values via a ref bundle — no listener re-registration
 * on state change, no accumulation.
 */

import { useEffect, useRef } from "react";
import { useSettings } from "../contexts/SettingsContext";
import { useRecording } from "../contexts/RecordingContext";
import { useLiveSessionContext } from "../contexts/LiveSessionContext";
import {
  registerGlobalShortcut,
  unregisterGlobalShortcut,
  registerVoiceShortcut,
  unregisterVoiceShortcut,
} from "../services/platform/globalShortcutService";
import { environmentService } from "../services/platform/environmentService";
import { pulseCoordinator } from "../services/platform/pulseCoordinator";
import { logger } from "../services/logging/logger";
import { RecordingState } from "../types";
import type { View } from "../types/navigation";
import { isResolvedDark } from "../utils/theme";
import { sampleAudioLevels } from "../utils/audioLevels";

// ─── Props ────────────────────────────────────────────────────────────────────

interface GlobalShortcutHandlerProps {
  onViewChange: (view: View) => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function GlobalShortcutHandler({ onViewChange }: GlobalShortcutHandlerProps) {
  const { settings } = useSettings();
  const {
    startRecording,
    stopRecording,
    isRecording,
    isProcessing,
    recordingState,
    reset,
    finalTranscript,
    rephrasedText,
    analyserRef,
  } = useRecording();

  // Voice session — controlled directly from here; never navigates to VoicePage
  const { sessionState: voiceSessionState, startSession: startVoice, endSession: endVoice } =
    useLiveSessionContext();

  // ── Ref bundle ───────────────────────────────────────────────────────────────
  // Updated every render so long-lived event listeners always see current values
  // without needing to be re-registered (which would accumulate listeners).
  const refs = useRef({
    isRecording,
    isProcessing,
    startRecording,
    stopRecording,
    reset,
    recordingState,
    autoRephrase: settings.autoRephrase,
    overlayOpacity: settings.overlayOpacity,
    finalTranscript,
    rephrasedText,
    onViewChange,
    voiceSessionState,
    startVoice,
    endVoice,
  });
  refs.current = {
    isRecording,
    isProcessing,
    startRecording,
    stopRecording,
    reset,
    recordingState,
    autoRephrase: settings.autoRephrase,
    overlayOpacity: settings.overlayOpacity,
    finalTranscript,
    rephrasedText,
    onViewChange,
    voiceSessionState,
    startVoice,
    endVoice,
  };

  // ── Shortcut registration ─────────────────────────────────────────────────

  useEffect(() => {
    registerGlobalShortcut(settings.recordingShortcut);
    return () => { unregisterGlobalShortcut(); };
  }, [settings.recordingShortcut]);

  useEffect(() => {
    registerVoiceShortcut(settings.voiceShortcut);
    return () => { unregisterVoiceShortcut(); };
  }, [settings.voiceShortcut]);

  // ── Voice shortcut → toggle session directly (no page navigation) ─────────
  // Ctrl+Shift+V:
  //   session idle    → start voice session in background
  //   session active  → end voice session
  // The session lives in LiveSessionContext above all pages, so it survives
  // any page navigation. VoicePage is just a UI window; it is NOT required.

  useEffect(() => {
    if (!environmentService.isTauri()) return;
    let unlisten: (() => void) | null = null;
    let cancelled = false;

    import("@tauri-apps/api/event")
      .then(({ listen }) =>
        listen("voice-shortcut-triggered", async () => {
          const r = refs.current;
          if (r.voiceSessionState === "idle") {
            if (r.isProcessing) return;
            if (r.recordingState !== RecordingState.IDLE) return;
            r.startVoice().catch((err) =>
              logger.warn("GlobalShortcut", "Voice session start failed", err)
            );
          } else {
            r.endVoice();
            pulseCoordinator.endVoice(r.overlayOpacity).catch(() => null);
          }
        })
      )
      .then((fn) => {
        if (cancelled) { fn(); return; }
        unlisten = fn;
      })
      .catch((err) =>
        logger.warn("GlobalShortcut", "Failed to setup voice shortcut listener", err)
      );

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []); // stable — refs handle live values

  // ── Overlay enabled / opacity sync (also runs on mount) ──────────────────
  // Handles: initial window creation, re-init when user toggles the island on,
  // and idle-opacity updates. Theme is passed at init time to fix the race where
  // the overlay window doesn't exist yet when studio:overlay-theme is first sent.
  // theme handled by dedicated effect below; only re-init on toggle + opacity change
  useEffect(() => {
    if (!environmentService.isTauri()) return;
    pulseCoordinator.setEnabled(settings.showFloatingIsland);
    if (settings.showFloatingIsland) {
      pulseCoordinator
        .init(settings.overlayOpacity, isResolvedDark(settings.theme))
        .catch(() => null);
    }
  }, [settings.showFloatingIsland, settings.overlayOpacity]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Theme sync ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!environmentService.isTauri()) return;
    import("@tauri-apps/api/event").then(({ emitTo }) => {
      const dark = isResolvedDark(settings.theme);
      emitTo("overlay", "studio:overlay-theme", { dark }).catch(() => null);
    });
  }, [settings.theme]);

  // ── Idle island opacity / mode sync ──────────────────────────────────────
  useEffect(() => {
    if (!environmentService.isTauri()) return;
    if (recordingState === RecordingState.IDLE && voiceSessionState === "idle") {
      pulseCoordinator.showGlobalIdle(settings.overlayOpacity).catch(() => null);
    }
  }, [settings.overlayOpacity, recordingState, voiceSessionState]);

  // ── Recording state → overlay state ──────────────────────────────────────
  useEffect(() => {
    if (!environmentService.isTauri()) return;

    const transcript = rephrasedText || finalTranscript;
    const opacity    = settings.overlayOpacity;

    switch (recordingState) {
      case RecordingState.IDLE:
        // No-op — VoicePage manages its own overlay state; clobbering it here
        // would fight its speaking/listening indicators.
        break;

      case RecordingState.ERROR:
        pulseCoordinator.showTranscription({ state: recordingState, opacity }).catch(() => null);
        break;

      case RecordingState.RECORDING:
        pulseCoordinator
          .showTranscription({
            state: recordingState,
            autoRephrase: settings.autoRephrase,
            opacity,
          })
          .catch(() => null);
        break;

      case RecordingState.COMPLETE:
        pulseCoordinator
          .showTranscription({
            state: recordingState,
            transcript,
            autoRephrase: settings.autoRephrase,
            opacity,
          })
          .catch(() => null);
        break;

      default:
        // PROCESSING / TRANSCRIBING / REPHRASING
        pulseCoordinator.showTranscription({ state: recordingState, opacity }).catch(() => null);
    }
  }, [
    recordingState,
    finalTranscript,
    rephrasedText,
    settings.autoRephrase,
    settings.overlayOpacity,
  ]);

  useEffect(() => {
    if (!environmentService.isTauri()) return;
    if (recordingState !== RecordingState.RECORDING) return;

    const timer = window.setInterval(() => {
      const analyser = analyserRef.current;
      if (!analyser) return;

      pulseCoordinator.showTranscription({
        state: RecordingState.RECORDING,
        autoRephrase: settings.autoRephrase,
        audioLevels: sampleAudioLevels(analyser),
        opacity: settings.overlayOpacity,
      }).catch(() => null);
    }, 80);

    return () => window.clearInterval(timer);
  }, [analyserRef, recordingState, settings.autoRephrase, settings.overlayOpacity]);

  // ── Overlay action listener ───────────────────────────────────────────────
  // Registered ONCE — reads current values via refs to avoid re-registration.
  useEffect(() => {
    if (!environmentService.isTauri()) return;
    let unlisten: (() => void) | null = null;
    let cancelled = false;

    import("@tauri-apps/api/event")
      .then(({ listen }) =>
        listen<{ action: string; text?: string }>("studio:overlay-action", async (event) => {
          const { action, text } = event.payload;
          const r = refs.current;

          switch (action) {
            case "copy": {
              const text = r.rephrasedText || r.finalTranscript;
              if (text) navigator.clipboard.writeText(text).catch(() => null);
              break;
            }
            case "new":
            case "dismiss":
              if (r.voiceSessionState !== "idle") {
                r.endVoice();
                pulseCoordinator.endVoice(r.overlayOpacity).catch(() => null);
              }
              r.reset();
              pulseCoordinator.showGlobalIdle(r.overlayOpacity).catch(() => null);
              break;

            case "expand": {
              try {
                const { getCurrentWindow } = await import("@tauri-apps/api/window");
                const win = getCurrentWindow();
                await win.show();
                await win.unminimize();
                await win.setFocus();
              } catch { /* not Tauri or already focused */ }
              r.onViewChange("transcribe");
              break;
            }

            case "focus": {
              try {
                const { getCurrentWindow } = await import("@tauri-apps/api/window");
                const win = getCurrentWindow();
                await win.show();
                await win.unminimize();
                await win.setFocus();
              } catch { /* not Tauri */ }
              break;
            }

            case "openChat": {
              try {
                const { getCurrentWindow } = await import("@tauri-apps/api/window");
                const win = getCurrentWindow();
                await win.unminimize();
                await win.show();
                await win.setFocus();
              } catch { /* not Tauri */ }

              r.onViewChange("chat");

              const draft = text?.trim();
              window.setTimeout(() => {
                if (draft) {
                  window.dispatchEvent(new CustomEvent("inject-chat-text", {
                    detail: { text: draft },
                  }));
                } else {
                  window.dispatchEvent(new CustomEvent("focus-chat-input"));
                }
              }, 120);
              break;
            }

            case "startVoice": {
              if (r.voiceSessionState !== "idle" || r.isProcessing) break;
              if (r.recordingState !== RecordingState.IDLE) break;
              r.startVoice().catch((err) =>
                logger.warn("GlobalShortcut", "Voice session start failed", err)
              );
              break;
            }

            case "startTranscription": {
              if (r.isRecording) {
                await r.stopRecording();
                break;
              }

              if (r.isProcessing) break;

              if (r.voiceSessionState !== "idle") {
                r.endVoice();
                await pulseCoordinator.endVoice(r.overlayOpacity);
              }

              r.reset();

              try {
                await pulseCoordinator.showTranscription({
                  state: RecordingState.RECORDING,
                  autoRephrase: r.autoRephrase,
                  opacity: r.overlayOpacity,
                });
              } catch {
                // Overlay failure must not prevent recording from starting
              }

              try {
                await r.startRecording(true);
              } catch (err) {
                logger.error("GlobalShortcut", "startRecording failed", err);
                pulseCoordinator
                  .showTranscription({ state: RecordingState.ERROR, opacity: r.overlayOpacity })
                  .catch(() => null);
              }
              break;
            }
          }
        })
      )
      .then((fn) => {
        if (cancelled) { fn(); return; }
        unlisten = fn;
      })
      .catch((err) =>
        logger.warn("GlobalShortcut", "Failed to setup overlay-action listener", err)
      );

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []); // stable — refs handle live values

  // ── Recording shortcut listener ───────────────────────────────────────────
  // Registered ONCE — reads current values via refs.
  useEffect(() => {
    if (!environmentService.isTauri()) return;
    let unlisten: (() => void) | null = null;
    let cancelled = false;

    import("@tauri-apps/api/event")
      .then(({ listen }) =>
        listen("global-shortcut-triggered", async () => {
          const r = refs.current;

          if (r.isRecording) {
            await r.stopRecording();
            return;
          }

          if (r.isProcessing) return; // ignore hotkey while processing

          if (r.voiceSessionState !== "idle") {
            r.endVoice();
            await pulseCoordinator.endVoice(r.overlayOpacity);
          }

          // Start a fresh recording
          r.reset();

          try {
            await pulseCoordinator.showTranscription({
              state: RecordingState.RECORDING,
              autoRephrase: r.autoRephrase,
              opacity: r.overlayOpacity,
            });
          } catch {
            // Overlay failure must not prevent recording from starting
          }

          try {
            await r.startRecording(true);
          } catch (err) {
            logger.error("GlobalShortcut", "startRecording failed", err);
            pulseCoordinator
              .showTranscription({ state: RecordingState.ERROR, opacity: r.overlayOpacity })
              .catch(() => null);
          }
        })
      )
      .then((fn) => {
        if (cancelled) { fn(); return; }
        unlisten = fn;
      })
      .catch((err) =>
        logger.warn("GlobalShortcut", "Failed to setup shortcut listener", err)
      );

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []); // stable — refs handle live values

  return null; // headless — no rendered output
}
