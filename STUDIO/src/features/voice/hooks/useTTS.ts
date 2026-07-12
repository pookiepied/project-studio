import { useState, useRef, useCallback } from "react";
import { apiClient } from "@/lib/api";
import { isEdgeTtsModel, voiceIdFromModel, synthesizeSpeech, chunkTextForSpeech } from "@/features/tts/local";
import { logger } from "@/core/logging/logger";

const LABEL_MAX_CHARS = 80;

function toLabel(text: string): string {
  const trimmed = text.trim().replace(/\s+/g, " ");
  return trimmed.length > LABEL_MAX_CHARS ? `${trimmed.slice(0, LABEL_MAX_CHARS)}…` : trimmed;
}

interface TTSState {
  /** Message ID currently being played, or null */
  playingId: string | null;
  /** Message ID currently loading audio for, or null */
  loadingId: string | null;
  /** True while playback is paused (playingId stays set so the mini player keeps its target). */
  isPaused: boolean;
  /** Short preview of the text currently being read, for the mini player. */
  label: string | null;
}

const IDLE_STATE: TTSState = { playingId: null, loadingId: null, isPaused: false, label: null };

export function useTTS() {
  const [state, setState] = useState<TTSState>(IDLE_STATE);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const objectUrlRef = useRef<string | null>(null);
  // Chunk queue for local (Edge TTS) playback — invalidated on stop() via generation counter.
  const chunkQueueRef = useRef<Array<{ text: string; urlPromise: Promise<string | null> }>>([]);
  const generationRef = useRef(0);

  const cleanup = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.onended = null;
      audioRef.current.onerror = null;
      audioRef.current = null;
    }
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }
  }, []);

  const stop = useCallback(() => {
    generationRef.current++;
    chunkQueueRef.current = [];
    cleanup();
    setState(IDLE_STATE);
  }, [cleanup]);

  const pause = useCallback(() => {
    if (!audioRef.current || audioRef.current.paused) return;
    audioRef.current.pause();
    setState((s) => (s.playingId ? { ...s, isPaused: true } : s));
  }, []);

  const resume = useCallback(() => {
    if (!audioRef.current || !audioRef.current.paused) return;
    audioRef.current.play().catch(() => {});
    setState((s) => (s.playingId ? { ...s, isPaused: false } : s));
  }, []);

  const togglePause = useCallback(() => {
    if (audioRef.current?.paused) resume();
    else pause();
  }, [pause, resume]);

  // ── Cloud TTS: single request for the whole message (unchanged behavior) ──
  const speakCloud = useCallback(
    async (messageId: string, text: string, model: string) => {
      try {
        const response = await apiClient.postBinary("/audio/speech", { model, input: text });

        if (!response.ok) {
          setState(IDLE_STATE);
          return;
        }

        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        objectUrlRef.current = url;

        const audio = new Audio(url);
        audioRef.current = audio;

        audio.onended = () => {
          cleanup();
          setState(IDLE_STATE);
        };
        audio.onerror = () => {
          cleanup();
          setState(IDLE_STATE);
        };

        setState((s) => ({ ...s, playingId: messageId, loadingId: null }));
        await audio.play();
      } catch {
        cleanup();
        setState(IDLE_STATE);
      }
    },
    [cleanup]
  );

  // ── Local Edge TTS: chunk the message, synthesize + play chunk-by-chunk ───
  // Chunk N+1 synthesizes in the background while chunk N plays, so playback
  // doesn't stall waiting on the next subprocess call.
  const speakLocal = useCallback(
    async (messageId: string, text: string, voiceId: string) => {
      const generation = generationRef.current;
      const chunks = chunkTextForSpeech(text);

      if (chunks.length === 0) {
        setState(IDLE_STATE);
        return;
      }

      const synthesizeChunk = (chunkText: string): Promise<string | null> =>
        synthesizeSpeech(chunkText, voiceId)
          .then((blob) => (generationRef.current === generation ? URL.createObjectURL(blob) : null))
          .catch((error) => {
            logger.error("useTTS", "Local synthesis failed", error);
            return null;
          });

      chunkQueueRef.current = chunks.map((chunkText) => ({
        text: chunkText,
        urlPromise: synthesizeChunk(chunkText),
      }));

      const playNext = async () => {
        if (generationRef.current !== generation) return;
        if (chunkQueueRef.current.length === 0) {
          cleanup();
          setState(IDLE_STATE);
          return;
        }

        const item = chunkQueueRef.current.shift()!;
        const url = await item.urlPromise;

        if (generationRef.current !== generation) {
          if (url) URL.revokeObjectURL(url);
          return;
        }

        if (!url) {
          playNext();
          return;
        }

        const audio = new Audio(url);
        audioRef.current = audio;
        objectUrlRef.current = url;
        audio.onended = () => {
          URL.revokeObjectURL(url);
          objectUrlRef.current = null;
          playNext();
        };
        audio.onerror = () => {
          URL.revokeObjectURL(url);
          objectUrlRef.current = null;
          playNext();
        };

        setState((s) => ({ ...s, playingId: messageId, loadingId: null }));
        await audio.play().catch(() => playNext());
      };

      await playNext();
    },
    [cleanup]
  );

  const speak = useCallback(
    async (messageId: string, text: string, model: string) => {
      // Toggle off if already playing this message
      if (state.playingId === messageId || state.loadingId === messageId) {
        stop();
        return;
      }

      // Stop any current playback before starting new one
      generationRef.current++;
      chunkQueueRef.current = [];
      cleanup();
      setState({ playingId: null, loadingId: messageId, isPaused: false, label: toLabel(text) });

      if (isEdgeTtsModel(model)) {
        await speakLocal(messageId, text, voiceIdFromModel(model));
      } else {
        await speakCloud(messageId, text, model);
      }
    },
    [state.playingId, state.loadingId, stop, cleanup, speakLocal, speakCloud]
  );

  return {
    speak,
    stop,
    pause,
    resume,
    togglePause,
    playingId: state.playingId,
    loadingId: state.loadingId,
    isPlaying: state.playingId !== null,
    isPaused: state.isPaused,
    label: state.label,
  };
}
