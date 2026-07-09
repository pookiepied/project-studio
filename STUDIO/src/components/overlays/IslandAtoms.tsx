/**
 * IslandAtoms — primitive building blocks for FloatingIsland.
 *
 * Each atom is a focused, single-responsibility component.
 * Also exports the shared SPRING config and processingLabel helper.
 */

import { motion } from "framer-motion";
import {
  MicrophoneIcon as Microphone,
  ChatCircleIcon as ChatCircle,
} from "@phosphor-icons/react";
import { RecordingState } from "../../types";
import type { IslandMode } from "../../core/platform/overlayService";

// ─── Shared animation spring ──────────────────────────────────────────────────
// Matches Studio's panel / NavPopup spring exactly.

export const SPRING = {
  type: "spring",
  stiffness: 380,
  damping: 28,
  mass: 0.75,
} as const;

// ─── Waveform bars ────────────────────────────────────────────────────────────

/**
 * Five-bar waveform — always animates with a gentle fake rhythm so the island
 * never looks empty, even during silence gaps between speech.
 */
export function WaveformBars({ levels }: { levels?: number[] }) {
  const bases = [0.28, 0.55, 0.85, 0.45, 0.28];
  const values = levels?.length ? levels : bases;
  const hasRealLevels = !!levels?.length;

  return (
    <div className="flex items-center gap-[2.5px]" style={{ height: 14 }}>
      {values.map((val, i) => (
        <motion.div
          key={i}
          className="w-[2.5px] rounded-full bg-gray-500 dark:bg-gray-300"
          style={{ height: "100%", scaleY: Math.max(0.08, val), transformOrigin: "center" }}
          animate={hasRealLevels ? { scaleY: Math.max(0.08, val) } : { scaleY: [val, val + 0.35, val + 0.1, val + 0.5, val] }}
          transition={hasRealLevels
            ? { duration: 0.08, ease: "easeOut" }
            : {
                duration: 0.85,
                repeat: Infinity,
                delay: i * 0.1,
                ease: "easeInOut",
              }}
        />
      ))}
    </div>
  );
}

// ─── Speaking bars ────────────────────────────────────────────────────────────

/**
 * Slightly smaller bars used for the voice AI-speaking state.
 * Same aesthetic as WaveformBars but tighter and slower.
 */
export function SpeakingBars() {
  const bases = [0.4, 0.8, 1, 0.7, 0.45];
  return (
    <div className="flex items-center gap-[2px]" style={{ height: 11 }}>
      {bases.map((base, i) => (
        <motion.div
          key={i}
          className="w-[2px] rounded-full bg-gray-400 dark:bg-gray-400"
          style={{ height: "100%", scaleY: base, transformOrigin: "center" }}
          animate={{ scaleY: [base, base + 0.3, base + 0.05, base + 0.45, base] }}
          transition={{
            duration: 0.7,
            repeat: Infinity,
            delay: i * 0.08,
            ease: "easeInOut",
          }}
        />
      ))}
    </div>
  );
}

// ─── Recording dot ────────────────────────────────────────────────────────────

/** Pulsing red dot — indicates an active recording session. */
export function RecDot() {
  return (
    <span className="relative flex h-[7px] w-[7px] flex-shrink-0">
      <motion.span
        className="absolute inline-flex h-full w-full rounded-full bg-surface-raised"
        animate={{ scale: [1, 1.9, 1], opacity: [0.65, 0, 0.65] }}
        transition={{ duration: 1.4, repeat: Infinity, ease: "easeInOut" }}
      />
      <span className="relative inline-flex h-[7px] w-[7px] rounded-full bg-surface-raised" />
    </span>
  );
}

// ─── Loading ring ─────────────────────────────────────────────────────────────

/** Spinning arc — shown while processing / transcribing / rephrasing. */
export function LoadingRing() {
  return (
    <motion.div
      animate={{ rotate: 360 }}
      transition={{ duration: 0.9, repeat: Infinity, ease: "linear" }}
      className="
        w-[13px] h-[13px] rounded-full flex-shrink-0
        border-[1.5px]
        border-gray-300 dark:border-gray-700
        border-t-gray-600 dark:border-t-gray-300
      "
    />
  );
}

// ─── Idle icon ────────────────────────────────────────────────────────────────

/** Compact Pulse mark derived from StudioMark's alternating vertical tiles. */
export function PulseMark({ size = 14 }: { size?: number }) {
  const tiles = [
    { x: 8, y: 2 },
    { x: 15, y: 10 },
    { x: 8, y: 18 },
  ] as const;

  return (
    <motion.svg
      width={size}
      height={size}
      viewBox="0 0 28 28"
      fill="none"
      aria-hidden="true"
      className="text-gray-600 dark:text-gray-400"
      animate={{ opacity: [0.92, 0.64, 0.92] }}
      transition={{ duration: 2.8, repeat: Infinity, ease: "easeInOut" }}
      shapeRendering="geometricPrecision"
    >
      {tiles.map((tile, index) => (
        <motion.rect
          key={`${tile.x}-${tile.y}`}
          x={tile.x}
          y={tile.y}
          width="7"
          height="7"
          rx="2"
          fill="currentColor"
          style={{ transformBox: "fill-box", transformOrigin: "center" }}
          animate={{ scale: [1, 0.88, 1] }}
          transition={{
            duration: 2.8,
            repeat: Infinity,
            delay: index * 0.12,
            ease: "easeInOut",
          }}
        />
      ))}
    </motion.svg>
  );
}

/** Tiny breathing icon in the idle pill: Pulse mark, mic, or voice icon. */
export function IdleIcon({ mode }: { mode: IslandMode }) {
  return (
    <motion.div
      animate={{ opacity: [0.9, 0.68, 0.9] }}
      transition={{ duration: 2.8, repeat: Infinity, ease: "easeInOut" }}
      className="flex items-center justify-center"
    >
      {mode === "voice" ? (
        <ChatCircle size={12} weight="regular" className="text-gray-500 dark:text-gray-500" />
      ) : mode === "global" || mode === "artifact" ? (
        <PulseMark size={13} />
      ) : (
        <Microphone size={12} weight="regular" className="text-gray-500 dark:text-gray-500" />
      )}
    </motion.div>
  );
}

// ─── Action button ────────────────────────────────────────────────────────────

interface ActionBtnProps {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}

/**
 * Small circular button — matches Studio's translucent button design language.
 * Used in the COMPLETE state for copy / expand / new / dismiss.
 */
export function ActionBtn({ icon, label, onClick }: ActionBtnProps) {
  return (
    <motion.button
      onClick={onClick}
      title={label}
      whileHover={{ scale: 1.06 }}
      whileTap={{ scale: 0.94 }}
      transition={{ duration: 0.15 }}
      className="
        flex items-center justify-center w-[26px] h-[26px] rounded-full
        bg-gray-900/[0.05] dark:bg-white/[0.06]
        hover:bg-gray-900/[0.08] dark:hover:bg-white/[0.10]
        text-gray-500 dark:text-gray-400
        transition-colors duration-100
      "
      style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
    >
      {icon}
    </motion.button>
  );
}

// ─── processingLabel helper ───────────────────────────────────────────────────

/** Returns the human-readable label for in-progress states. */
export function processingLabel(state: RecordingState): string {
  switch (state) {
    case RecordingState.PROCESSING:   return "Processing";
    case RecordingState.TRANSCRIBING: return "Transcribing";
    case RecordingState.REPHRASING:   return "Rephrasing";
    default:                          return "Working";
  }
}
