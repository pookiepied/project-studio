import { useState, useRef, useCallback } from "react";
import { apiClient } from "../utils/api";

interface TTSState {
  /** Message ID currently being played, or null */
  playingId: string | null;
  /** Message ID currently loading audio for, or null */
  loadingId: string | null;
}

export function useTTS() {
  const [state, setState] = useState<TTSState>({ playingId: null, loadingId: null });
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const objectUrlRef = useRef<string | null>(null);

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
    cleanup();
    setState({ playingId: null, loadingId: null });
  }, [cleanup]);

  const speak = useCallback(
    async (messageId: string, text: string, model: string) => {
      // Toggle off if already playing this message
      if (state.playingId === messageId || state.loadingId === messageId) {
        stop();
        return;
      }

      // Stop any current playback before starting new one
      cleanup();
      setState({ playingId: null, loadingId: messageId });

      try {
        const response = await apiClient.postBinary("/audio/speech", {
        model: model,
        input: text,
      });

        if (!response.ok) {
          setState({ playingId: null, loadingId: null });
          return;
        }

        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        objectUrlRef.current = url;

        const audio = new Audio(url);
        audioRef.current = audio;

        audio.onended = () => {
          cleanup();
          setState({ playingId: null, loadingId: null });
        };

        audio.onerror = () => {
          cleanup();
          setState({ playingId: null, loadingId: null });
        };

        setState({ playingId: messageId, loadingId: null });
        await audio.play();
      } catch {
        cleanup();
        setState({ playingId: null, loadingId: null });
      }
    },
    [state.playingId, state.loadingId, stop, cleanup]
  );

  return {
    speak,
    stop,
    playingId: state.playingId,
    loadingId: state.loadingId,
    isPlaying: state.playingId !== null,
  };
}
