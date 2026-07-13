/**
 * VoicePage — minimal voice-session interface.
 *
 * Intentionally simple: a plain neutral surface with the core session controls
 * (start / mic / end / speaker) and the live transcript + AI text. The previous
 * full-page animated gradient + radial-presence "orb" was removed per product
 * direction (2026-07-07) — this is a deliberate functional placeholder we'll
 * redesign later. Strict-neutral (D-401): state is signalled by icon + weight +
 * neutral surface only, never hue.
 *
 * All session logic still lives in LiveSessionProvider (above the page) so it
 * survives navigation; this component is just the UI window into that session.
 */

import { useEffect, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  MicrophoneIcon,
  MicrophoneSlashIcon,
  PhoneXIcon,
  SpeakerHighIcon,
  SpeakerSlashIcon,
} from "@/ui/icons";
import { SessionState } from "@/features/voice/hooks/useLiveSession";
import { useLiveSessionContext } from "@/features/voice/context/LiveSessionContext";
import { IconButton } from "@/ui/primitives/IconButton";
import { Button } from "@/ui/primitives/Button";
import { Icon, Settings, Warning } from "@/ui/icons";
import { liveSessionSounds } from "../utils/liveSessionSounds";

const STATE_LABELS: Record<SessionState, string> = {
  idle:       "",
  connecting: "Connecting",
  listening:  "Listening",
  processing: "Thinking",
  speaking:   "Speaking",
  error:      "Error",
};

// Neutral dot pulse cadence — speed grows with activity. Error uses a Warning
// glyph (rendered in JSX) instead of a dot, so it has no cadence entry.
const DOT_PULSE_DUR: Record<Exclude<SessionState, "idle" | "error">, number> = {
  connecting: 3,
  listening:  1.1,
  processing: 0.45,
  speaking:   0.65,
};

function formatSeconds(s: number): string {
  const m   = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

// ── Component ─────────────────────────────────────────────────────────────────

export const VoicePage = ({ onNavigateSettings }: { onNavigateSettings?: () => void }) => {
  // Session lives in LiveSessionProvider (above all pages) so it survives
  // navigation. VoicePage is just the UI window into the session.
  const {
    sessionState,
    transcript,
    aiText,
    isMicMuted,
    isSpeakerMuted,
    sessionSeconds,
    error,
    startSession,
    endSession,
    toggleMicMute,
    toggleSpeakerMute,
  } = useLiveSessionContext();

  const isActive = sessionState !== "idle" && sessionState !== "error";

  // ── Sound effects on state transitions ───────────────────────────────────
  const prevStateRef = useRef<SessionState>("idle");
  useEffect(() => {
    const prev = prevStateRef.current;
    const next = sessionState;
    prevStateRef.current = next;
    if (prev === "connecting" && next === "listening") liveSessionSounds.connect();
    if (prev !== "idle"      && next === "idle")       liveSessionSounds.disconnect();
  }, [sessionState]);

  const handleToggleMic = useCallback(() => {
    const willBeMuted = !isMicMuted;
    if (willBeMuted) liveSessionSounds.micMute();
    else liveSessionSounds.micUnmute();
    toggleMicMute();
  }, [isMicMuted, toggleMicMute]);

  const handleToggleSpeaker = useCallback(() => {
    const willBeMuted = !isSpeakerMuted;
    if (willBeMuted) liveSessionSounds.speakerMute();
    else liveSessionSounds.speakerUnmute();
    toggleSpeakerMute();
  }, [isSpeakerMuted, toggleSpeakerMute]);

  const aiTextRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (aiTextRef.current) {
      aiTextRef.current.scrollTop = aiTextRef.current.scrollHeight;
    }
  }, [aiText]);

  return (
    <div className="relative h-full overflow-hidden select-none bg-surface-page">
      <div className="relative z-10 h-full flex flex-col items-center justify-between">

        {/* ── Top bar ── */}
        <div className="w-full flex items-center justify-between px-6 pt-5 pb-2">
          <div className="flex items-center gap-3 h-5">

            <AnimatePresence mode="wait">
              {isActive && (
                <motion.span
                  key="timer"
                  initial={{ opacity: 0, x: -6 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -6 }}
                  transition={{ duration: 0.2 }}
                  className="font-mono text-xs text-muted tabular-nums"
                >
                  {formatSeconds(sessionSeconds)}
                </motion.span>
              )}
            </AnimatePresence>

            <AnimatePresence mode="wait">
              {sessionState !== "idle" && (
                <motion.div
                  key={sessionState}
                  initial={{ opacity: 0, y: -3 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 3 }}
                  transition={{ duration: 0.18 }}
                  className="flex items-center gap-1.5"
                >
                  {/* Neutral state indicator: a pulsing dot for active states;
                      a Warning glyph (§11.3 colorless) for error. */}
                  {sessionState === "error" ? (
                    <Warning size="sm" className="text-primary" />
                  ) : (
                    <motion.div
                      className="w-1 h-1 rounded-full bg-primary"
                      animate={{ opacity: [0.4, 1, 0.4] }}
                      transition={{
                        duration: DOT_PULSE_DUR[sessionState as Exclude<SessionState, "idle" | "error">],
                        repeat:  Infinity,
                        ease:    "easeInOut",
                      }}
                    />
                  )}
                  <span className="text-xs text-muted font-mono tracking-widest">
                    {STATE_LABELS[sessionState]}
                  </span>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          <IconButton
            aria-label="Open settings"
            variant="ghost"
            size="sm"
            onClick={onNavigateSettings}
          >
            <Settings size="sm" />
          </IconButton>
        </div>

        {/* ── Center content ── */}
        <div className="flex-1 flex flex-col items-center justify-center gap-5 px-8 w-full">

          {/* Idle: tap-to-start */}
          <AnimatePresence mode="wait">
            {sessionState === "idle" && (
              <Button
                key="tap-hint"
                variant="ghost"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.28 }}
                onClick={startSession}
                className="flex flex-col items-center gap-3 group"
              >
                <motion.div
                  animate={{ scale: [1, 1.08, 1], opacity: [0.45, 0.75, 0.45] }}
                  transition={{ duration: 3.5, repeat: Infinity, ease: "easeInOut" }}
                  className="w-11 h-11 rounded-full flex items-center justify-center bg-surface-hover border border-surface-border"
                >
                  <Icon icon={MicrophoneIcon} size="sm" className="text-secondary group-hover:text-primary transition-colors duration-normal ease-standard" />
                </motion.div>
                <span className="text-xs text-muted font-mono tracking-widest">
                  tap to start
                </span>
              </Button>
            )}
          </AnimatePresence>

          {/* Transcript + AI text */}
          <div className="w-full max-w-[260px] space-y-3 text-center">

            <AnimatePresence mode="wait">
              {transcript && isActive && (
                <motion.p
                  key={transcript.slice(-30)}
                  initial={{ opacity: 0, y: 5 }}
                  animate={{ opacity: 0.55, y: 0 }}
                  exit={{ opacity: 0, y: -3 }}
                  transition={{ duration: 0.25 }}
                  className="text-xs text-muted font-mono leading-relaxed line-clamp-2"
                >
                  {transcript}
                </motion.p>
              )}
            </AnimatePresence>

            <AnimatePresence mode="wait">
              {aiText && (sessionState === "speaking" || sessionState === "processing") && (
                <motion.div
                  key="ai-text"
                  ref={aiTextRef}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.25 }}
                  className="text-sm text-secondary leading-relaxed font-sans max-h-[72px] overflow-hidden"
                  style={{ maskImage: "linear-gradient(to bottom, black 55%, transparent 100%)" }}
                >
                  {aiText}
                </motion.div>
              )}
            </AnimatePresence>

            <AnimatePresence>
              {error && (
                <motion.p
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="text-xs text-secondary font-mono"
                >
                  {error}
                </motion.p>
              )}
            </AnimatePresence>
          </div>
        </div>

        {/* ── Controls ── */}
        <div className="w-full flex items-center justify-center gap-5 pb-8 pt-4">

          <AnimatePresence>
            {isActive && (
              <motion.div
                key="active-controls"
                className="flex items-center gap-5"
                initial={{ opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 8, transition: { duration: 0.18 } }}
                transition={{ duration: 0.22 }}
              >
                {/* Mic — circular motion.button (no circular-button primitive;
                    C-406 precedent). "muted" = stronger fill; "on" = ghost. */}
                <Button
                  variant="ghost"
                  initial={{ opacity: 0, scale: 0.72, y: 14 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  transition={{ type: "spring", stiffness: 220, damping: 20, delay: 0 }}
                  whileTap={{ scale: 0.95 }}
                  onClick={handleToggleMic}
                  aria-label={isMicMuted ? "Unmute microphone" : "Mute microphone"}
                  className={`flex items-center justify-center w-11 h-11 rounded-full border transition-colors duration-normal ease-standard focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus ${
                    isMicMuted
                      ? "bg-surface-selected border-surface-border text-primary"
                      : "bg-surface-base border-surface-border text-secondary hover:bg-surface-hover hover:text-primary"
                  }`}
                >
                  {isMicMuted
                    ? <Icon icon={MicrophoneSlashIcon} size="sm" />
                    : <Icon icon={MicrophoneIcon}      size="sm" />
                  }
                </Button>

                {/* End call — destructive (filled graphite/near-black + icon,
                    never red, per §11.3 + D-401). 52px hero control. */}
                <Button
                  variant="primary"
                  initial={{ opacity: 0, scale: 0.72, y: 14 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  transition={{ type: "spring", stiffness: 220, damping: 20, delay: 0.08 }}
                  whileTap={{ scale: 0.95 }}
                  onClick={endSession}
                  aria-label="End voice session"
                  className="flex items-center justify-center w-[52px] h-[52px] rounded-full border border-surface-border transition-colors duration-normal ease-standard focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus "
                >
                  <Icon icon={PhoneXIcon} size="md" />
                </Button>

                {/* Speaker — same state model as mic */}
                <Button
                  variant="ghost"
                  initial={{ opacity: 0, scale: 0.72, y: 14 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  transition={{ type: "spring", stiffness: 220, damping: 20, delay: 0.16 }}
                  whileTap={{ scale: 0.95 }}
                  onClick={handleToggleSpeaker}
                  aria-label={isSpeakerMuted ? "Unmute speaker" : "Mute speaker"}
                  className={`flex items-center justify-center w-11 h-11 rounded-full border transition-colors duration-normal ease-standard focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus ${
                    isSpeakerMuted
                      ? "bg-surface-selected border-surface-border text-primary"
                      : "bg-surface-base border-surface-border text-secondary hover:bg-surface-hover hover:text-primary"
                  }`}
                >
                  {isSpeakerMuted
                    ? <Icon icon={SpeakerSlashIcon} size="sm" />
                    : <Icon icon={SpeakerHighIcon}  size="sm" />
                  }
                </Button>
              </motion.div>
            )}
          </AnimatePresence>

          <AnimatePresence>
            {sessionState === "error" && (
              <Button
                variant="primary"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                whileTap={{ scale: 0.95 }}
                onClick={() => { endSession(); setTimeout(startSession, 80); }}
                className="px-5 py-2.5 rounded-full border border-surface-border text-sm font-mono tracking-wide transition-colors duration-normal ease-standard focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus "
              >
                Retry
              </Button>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
};
