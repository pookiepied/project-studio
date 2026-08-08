import { createContext, useContext, type ReactNode } from "react";
import { useTTS } from "@/features/voice/hooks/useTTS";

type TTSContextValue = ReturnType<typeof useTTS>;

const TTSContext = createContext<TTSContextValue | null>(null);

/**
 * Mounted once at the app root (see AppProviders) so read-aloud playback
 * survives navigating between pages — the audio element lives here, not in
 * ChatPage, so switching views no longer stops or loses the session.
 */
export function TTSProvider({ children }: { children: ReactNode }) {
  const tts = useTTS();
  return <TTSContext.Provider value={tts}>{children}</TTSContext.Provider>;
}

export function useTTSContext(): TTSContextValue {
  const ctx = useContext(TTSContext);
  if (!ctx) {
    throw new Error("useTTSContext must be used within a TTSProvider");
  }
  return ctx;
}
