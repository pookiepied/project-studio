/**
 * FloatingIsland - Dynamic Island-style always-on AI interface.
 *
 * Rendering stays intentionally thin. Product/state decisions live in
 * islandViewState so the visual component can grow without becoming the
 * policy layer for Pulse.
 */

import { useEffect, useCallback, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { FONT_SANS } from "@/design/fonts";
import {
  ArrowSquareOutIcon as ArrowsOut,
  XIcon as X,
  WarningCircleIcon as WarningCircle,
  SpeakerHighIcon as SpeakerHigh,
  UserSoundIcon as UserSound,
  ChatsCircleIcon as ChatsCircle,
} from "@phosphor-icons/react";

import type { OverlayPayload, OverlayActionType } from "@/core/platform/overlayService";
import { deriveIslandViewState, getIslandVisualSize } from "@/core/platform/islandViewState";
import { RecordingState } from "@/types";

import {
  SPRING,
  WaveformBars,
  SpeakingBars,
  RecDot,
  LoadingRing,
  IdleIcon,
  PulseMark,
  ActionBtn,
  processingLabel,
} from "./IslandAtoms";

import { PulseCardContent } from "./PulseCardView";
import type { VoiceCaptionState } from "@/features/voice/hooks/useLiveSession";

interface FloatingIslandProps {
  payload: OverlayPayload;
  ready: boolean;
  idleExpanded?: boolean;
  onIdleExpandedChange?: (expanded: boolean) => void;
  onAction: (action: OverlayActionType, text?: string) => void;
}

const CONTENT_ANIM = {
  initial: { opacity: 0, scale: 0.985 },
  animate: { opacity: 1, scale: 1 },
  exit: { opacity: 0, scale: 0.985 },
  transition: { duration: 0.2, ease: [0.16, 1, 0.3, 1] as const },
};

const TEXT_CONTENT_ANIM = {
  initial: { opacity: 0, scale: 0.99 },
  animate: { opacity: 1, scale: 1 },
  transition: { duration: 0.16, ease: [0.16, 1, 0.3, 1] as const },
};

const ISLAND_SPRING = {
  type: "spring",
  stiffness: 210,
  damping: 27,
  mass: 0.78,
} as const;

const CAPTION_WORDS_PER_LINE = 5;

function VoiceCaptionLine({
  caption,
  fallbackText,
}: {
  caption?: VoiceCaptionState;
  fallbackText?: string;
}) {
  const sourceText = caption?.text || fallbackText || "Speaking";
  const words = sourceText.trim().split(/\s+/).filter(Boolean);
  const safeWords = words.length ? words : ["Speaking"];
  const wordIndex = caption
    ? Math.min(Math.max(caption.wordIndex, 0), safeWords.length - 1)
    : 0;
  const lineStart = caption
    ? Math.floor(wordIndex / CAPTION_WORDS_PER_LINE) * CAPTION_WORDS_PER_LINE
    : 0;
  const lineWords = safeWords.slice(lineStart, lineStart + CAPTION_WORDS_PER_LINE);

  return (
    <div className="relative h-[18px] flex-1 min-w-0 overflow-hidden">
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={`${sourceText}-${lineStart}`}
          initial={{ y: 9, opacity: 0, filter: "blur(2px)" }}
          animate={{ y: 0, opacity: 1, filter: "blur(0px)" }}
          exit={{ y: -9, opacity: 0, filter: "blur(2px)" }}
          transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
          className="absolute inset-0 flex min-w-0 items-center gap-[3px] whitespace-nowrap"
          style={{ fontFamily: FONT_SANS }}
        >
          {lineWords.map((word, index) => {
            const absoluteIndex = lineStart + index;
            const isActive = caption && absoluteIndex === wordIndex;
            const isPast = caption && absoluteIndex < wordIndex;
            const tone = isActive || isPast
              ? "text-gray-800 dark:text-gray-100"
              : "text-gray-400 dark:text-gray-600";

            return (
              <motion.span
                key={`${absoluteIndex}-${word}`}
                animate={{
                  opacity: isActive ? 1 : isPast ? 0.92 : 0.5,
                  scale: isActive ? 1.03 : 1,
                }}
                transition={{ duration: 0.16, ease: "easeOut" }}
                className={`min-w-0 truncate text-sm leading-[18px] ${isActive ? "font-medium" : "font-normal"} ${tone}`}
              >
                {word}
              </motion.span>
            );
          })}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

export function FloatingIsland({
  payload,
  ready,
  idleExpanded = false,
  onIdleExpandedChange,
  onAction,
}: FloatingIslandProps) {
  const {
    state,
    transcript,
    rephrased,
    aiText,
    voiceCaption,
    opacity = 70,
    card,
    audioLevels,
    autoRephrase,
  } = payload;

  const view = deriveIslandViewState(payload, idleExpanded);
  const [hovered, setHovered] = useState(false);

  useEffect(() => {
    if (!view.isIdle && idleExpanded) {
      onIdleExpandedChange?.(false);
    }
  }, [idleExpanded, onIdleExpandedChange, view.isIdle]);

  useEffect(() => {
    if (!idleExpanded) return;
    if (hovered) return;
    const timer = window.setTimeout(() => onIdleExpandedChange?.(false), 6500);
    return () => window.clearTimeout(timer);
  }, [hovered, idleExpanded, onIdleExpandedChange]);

  useEffect(() => {
    if (!view.isComplete || view.isVoice || hovered) return;
    const delay = card?.autoDismissMs ?? 10_000;
    if (delay === 0) return;
    const t = setTimeout(() => onAction("dismiss"), delay);
    return () => clearTimeout(t);
  }, [view.isComplete, view.isVoice, hovered, onAction, card]);

  const displayText = rephrased || transcript || "";
  const truncated = displayText.length > 52 ? displayText.slice(0, 49) + "..." : displayText;

  const effectiveOpacity = view.isIdle ? opacity / 100 : 1;
  const slideY = ready ? (view.kind === "hidden" ? -80 : 8) : -80;
  const visualSize = getIslandVisualSize(view);
  const hasShellChrome = view.kind !== "hidden";
  const statusLabel =
    view.isVoice && view.kind === "processing"
      ? state === RecordingState.TRANSCRIBING || state === RecordingState.COMPLETE
        ? "Thinking"
        : "Connecting"
      : processingLabel(state);
  const activeModeLabel = view.isVoice
    ? "Live agent"
    : autoRephrase
      ? "Rephrase"
      : "Transcribe";

  const toggleIdleMenu = useCallback(() => {
    onIdleExpandedChange?.(!idleExpanded);
  }, [idleExpanded, onIdleExpandedChange]);

  const runAction = useCallback((action: OverlayActionType, text?: string) => {
    onIdleExpandedChange?.(false);
    onAction(action, text);
  }, [onAction, onIdleExpandedChange]);

  return (
    <div className="w-screen h-screen flex justify-center items-start pointer-events-none">
      <motion.div
        layout
        animate={{
          y: slideY,
          opacity: effectiveOpacity,
          width: visualSize.width,
          height: visualSize.height,
        }}
        transition={{
          layout: ISLAND_SPRING,
          width: ISLAND_SPRING,
          height: ISLAND_SPRING,
          y: SPRING,
          opacity: { duration: 0.25, ease: "easeOut" },
        }}
        onHoverStart={() => setHovered(true)}
        onHoverEnd={() => setHovered(false)}
        className={`
          pointer-events-auto
          flex items-center justify-center
          rounded-full overflow-hidden select-none
          ${hasShellChrome
            ? `bg-white dark:bg-surface-page
               border border-gray-900/[0.07] dark:border-white/[0.07]
               backdrop-blur-2xl
               shadow-[0_8px_40px_rgba(0,0,0,0.13),0_2px_8px_rgba(0,0,0,0.07)]
               dark:shadow-[0_8px_48px_rgba(0,0,0,0.65),0_2px_8px_rgba(0,0,0,0.4)]`
            : "bg-transparent border border-transparent shadow-none"}
        `}
        style={{
          WebkitAppRegion: "drag",
          willChange: "width, height, transform, opacity",
        } as React.CSSProperties}
      >
        <AnimatePresence mode="popLayout" initial={false}>
          {view.kind === "idle" && (
            <motion.button
              key="idle"
              layout
              {...CONTENT_ANIM}
              onClick={toggleIdleMenu}
              whileHover={{ scale: 1.04 }}
              whileTap={{ scale: 0.96 }}
              className="flex items-center justify-center px-4 h-7 cursor-pointer"
              style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
              title="Pulse"
            >
              <IdleIcon mode={view.mode} />
            </motion.button>
          )}

          {view.kind === "idleExpanded" && (
            <motion.div
              key="idle-expanded"
              layout
              {...CONTENT_ANIM}
              className="flex w-full items-center justify-center gap-1.5 px-2 h-[38px]"
              style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
            >
              <button
                type="button"
                onClick={toggleIdleMenu}
                title="Pulse"
                className="flex h-[26px] w-[26px] items-center justify-center rounded-full"
              >
                <PulseMark size={15} />
              </button>
              <div className="w-px h-4 bg-gray-900/[0.07] dark:bg-white/[0.07] mx-0.5" />
              <ActionBtn
                icon={<UserSound size={13} weight="regular" />}
                label="Start live agent"
                onClick={() => runAction("startVoice")}
              />
              <ActionBtn
                icon={<ChatsCircle size={13} weight="regular" />}
                label="Open chat"
                onClick={() => runAction("openChat")}
              />
              <ActionBtn
                icon={<ArrowsOut size={12} weight="regular" />}
                label="Open Studio"
                onClick={() => runAction("focus")}
              />
            </motion.div>
          )}

          {view.kind === "recording" && (
            <motion.div
              key="recording"
              layout
              {...TEXT_CONTENT_ANIM}
              className="flex items-center gap-2.5 px-4 h-[46px]"
              style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
            >
              <RecDot />
              <WaveformBars levels={audioLevels} />
              <span
                className="text-sm font-medium text-gray-700 dark:text-gray-200 whitespace-nowrap"
                style={{ fontFamily: FONT_SANS }}
              >
                {activeModeLabel}
              </span>
              {view.isVoice && (
                <ActionBtn
                  icon={<X size={10} weight="regular" />}
                  label="End live agent"
                  onClick={() => onAction("dismiss")}
                />
              )}
            </motion.div>
          )}

          {view.kind === "processing" && (
            <motion.div
              key={`processing-${state}`}
              layout
              {...TEXT_CONTENT_ANIM}
              className={`flex items-center gap-2.5 px-4 ${view.isVoice ? "h-[42px]" : "h-[46px]"}`}
              style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
            >
              <LoadingRing />
              <span
                className="text-sm font-medium text-gray-600 dark:text-gray-400 whitespace-nowrap"
                style={{ fontFamily: FONT_SANS }}
              >
                {statusLabel}
              </span>
              {view.isVoice && (
                <ActionBtn
                  icon={<X size={10} weight="regular" />}
                  label="End live agent"
                  onClick={() => onAction("dismiss")}
                />
              )}
            </motion.div>
          )}

          {view.kind === "completeCard" && card && (
            <PulseCardContent key="card" card={card} onAction={onAction} />
          )}

          {view.kind === "completeTranscription" && (
            <motion.div
              key="complete-transcription"
              layout
              {...TEXT_CONTENT_ANIM}
              className="flex items-center gap-2 px-3.5 h-[40px] max-w-[380px]"
              style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
            >
              <span
                className="text-sm text-gray-500 dark:text-gray-400 flex-1 min-w-0 truncate"
                style={{ fontFamily: FONT_SANS }}
              >
                {truncated || "Done"}
              </span>

              <div className="flex items-center gap-1 flex-shrink-0">
                <ActionBtn
                  icon={<ArrowsOut size={11} weight="regular" />}
                  label="Expand in Studio"
                  onClick={() => onAction("expand")}
                />
                <ActionBtn
                  icon={<X size={10} weight="regular" />}
                  label="Dismiss"
                  onClick={() => onAction("dismiss")}
                />
              </div>
            </motion.div>
          )}

          {view.kind === "completeVoice" && (
            <motion.div
              key="complete-voice"
              layout
              {...TEXT_CONTENT_ANIM}
              className="flex items-center gap-2.5 px-4 h-[46px] max-w-[350px]"
              style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
            >
              <SpeakerHigh
                size={13}
                weight="regular"
                className="text-gray-500 dark:text-gray-400 flex-shrink-0"
              />
              <SpeakingBars />
              <VoiceCaptionLine caption={voiceCaption} fallbackText={aiText} />
              <ActionBtn
                icon={<X size={10} weight="regular" />}
                label="End live agent"
                onClick={() => onAction("dismiss")}
              />
            </motion.div>
          )}

          {view.kind === "error" && (
            <motion.div
              key="error"
              layout
              {...CONTENT_ANIM}
              className="flex items-center gap-2.5 px-4 h-[46px]"
              style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
            >
              <WarningCircle
                size={13}
                weight="regular"
                className="text-secondary flex-shrink-0"
              />
              <span
                className="text-sm font-medium text-gray-600 dark:text-gray-400 whitespace-nowrap"
                style={{ fontFamily: FONT_SANS }}
              >
                Something went wrong
              </span>
              <div className="w-px h-3.5 bg-gray-900/[0.07] dark:bg-white/[0.07] mx-1" />
              <ActionBtn
                icon={<X size={10} weight="regular" />}
                label="Dismiss"
                onClick={() => onAction("dismiss")}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  );
}
