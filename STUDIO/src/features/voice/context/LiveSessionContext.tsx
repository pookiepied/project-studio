/**
 * LiveSessionContext — global voice session provider.
 *
 * The session lives here (above all pages) so it:
 *   • survives navigation — you can leave VoicePage without ending the call
 *   • can be started / stopped from any component (hotkey handler, VoicePage, etc.)
 *   • syncs its state to the Pulse overlay automatically
 *
 * VoicePage reads from this context instead of calling useLiveSession directly.
 * GlobalShortcutHandler calls startSession / endSession for the Ctrl+Shift+V hotkey
 * without navigating to VoicePage.
 */

import { createContext, useContext, useEffect, ReactNode, type RefObject } from "react";
import { useLiveSession, SessionState, type VoiceCaptionState } from "@/features/voice/hooks/useLiveSession";
import { useSettings } from "@/contexts/SettingsContext";
import { pulseCoordinator } from "@/core/platform/pulseCoordinator";
import { environmentService } from "@/core/platform/environmentService";
import { RecordingState } from "@/types";
import { sampleAudioLevels } from "@/utils/audioLevels";

// ─── Public shape ─────────────────────────────────────────────────────────────

export interface LiveSessionContextType {
  sessionState:      SessionState;
  transcript:        string;
  aiText:            string;
  voiceCaption:      VoiceCaptionState | null;
  isMicMuted:        boolean;
  isSpeakerMuted:    boolean;
  sessionSeconds:    number;
  error:             string | null;
  startSession:      () => Promise<void>;
  endSession:        () => void;
  toggleMicMute:     () => void;
  toggleSpeakerMute: () => void;
  analyserRef:       RefObject<AnalyserNode | null>;
}

const LiveSessionContext = createContext<LiveSessionContextType | null>(null);

// ─── Provider ─────────────────────────────────────────────────────────────────

export function LiveSessionProvider({ children }: { children: ReactNode }) {
  const { settings } = useSettings();

  const session = useLiveSession({
    model:              settings.defaultChatModel,
    ttsModel:           settings.ttsModel,
    transcriptionModel: settings.transcriptionModel,
    volume:             (settings.voiceVolume ?? 80) / 100,
  });

  const { sessionState, aiText, voiceCaption, analyserRef } = session;

  // ── Overlay sync ────────────────────────────────────────────────────────────
  // Moved here from VoicePage so the overlay reflects voice state regardless of
  // which page is currently visible.
  useEffect(() => {
    if (!environmentService.isTauri()) return;

    const opacity = settings.overlayOpacity;

    const stateMap: Record<SessionState, RecordingState> = {
      idle:       RecordingState.IDLE,
      connecting: RecordingState.PROCESSING,
      listening:  RecordingState.RECORDING,
      processing: RecordingState.TRANSCRIBING,
      speaking:   RecordingState.COMPLETE,
      error:      RecordingState.ERROR,
    };

    if (sessionState === "idle") {
      pulseCoordinator.endVoice(opacity).catch(() => null);
      return;
    }

    pulseCoordinator.showVoice({
      state:   stateMap[sessionState],
      aiText:  sessionState === "speaking" ? aiText : undefined,
      voiceCaption: sessionState === "speaking" ? voiceCaption ?? undefined : undefined,
      opacity,
    }).catch(() => null);
  }, [sessionState, aiText, voiceCaption, settings.overlayOpacity]);

  // Return island to idle when session ends (but not on every IDLE entry during
  // an active session — only when we come from a non-idle state).
  useEffect(() => {
    if (sessionState === "idle" && environmentService.isTauri()) {
      pulseCoordinator.endVoice(settings.overlayOpacity).catch(() => null);
    }
  }, [sessionState, settings.overlayOpacity]);

  useEffect(() => {
    if (!environmentService.isTauri()) return;
    if (sessionState !== "listening") return;

    const timer = window.setInterval(() => {
      const analyser = analyserRef.current;
      if (!analyser) return;

      pulseCoordinator.showVoice({
        state: RecordingState.RECORDING,
        audioLevels: sampleAudioLevels(analyser),
        opacity: settings.overlayOpacity,
      }).catch(() => null);
    }, 80);

    return () => window.clearInterval(timer);
  }, [analyserRef, sessionState, settings.overlayOpacity]);

  return (
    <LiveSessionContext.Provider value={session}>
      {children}
    </LiveSessionContext.Provider>
  );
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useLiveSessionContext(): LiveSessionContextType {
  const ctx = useContext(LiveSessionContext);
  if (!ctx) throw new Error("useLiveSessionContext must be used inside <LiveSessionProvider>");
  return ctx;
}
