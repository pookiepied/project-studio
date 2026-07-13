/**
 * TurnStatus — the single, always-mounted status line at the foot of a
 * conversation. It replaces the old ReadyIndicator ↔ GenerationStatus swap.
 *
 * Why one component instead of two: swapping two keyed children inside
 * <AnimatePresence mode="wait"> meant any sub-frame gap in the "is the turn
 * active" signal (phase hand-offs, auto-continue, the loading→streaming startup
 * window) tore the busy line down and briefly mounted the "ready" line — the
 * "reprovisioning" flicker. Here the component stays mounted for the whole
 * conversation and only morphs: the glyph changes animation (idle ↔ busy) and
 * the text swaps. Nothing unmounts, so nothing can re-animate its entrance.
 *
 * Robustness:
 *   - A short trailing debounce on the busy→idle edge swallows momentary flaps
 *     between turn phases, so the text never blinks to "ready" mid-turn.
 *   - The elapsed timer is anchored to a per-conversation timestamp in
 *     localStorage, so it survives a mid-turn refresh and resumes from the true
 *     start. It's set on the idle→busy edge and cleared on the busy→idle edge;
 *     a full reload skips cleanup, so the anchor correctly persists across it.
 *
 * Only the glyph animates — the text never shimmers.
 */

import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Collapse } from "@/ui/icons";
import type { ChatEngine } from "@/cliBridges/types";
import { EngineGlyph } from "./EngineGlyph";
import { ContextMeter } from "./ContextMeter";
import { Button } from "@/ui/primitives/Button";

const startKey = (convId: string) => `studio.genstart.${convId}`;

// Swallow busy→idle→busy flaps that happen between turn phases. Long enough to
// bridge a phase hand-off, short enough that a real turn-end still feels instant.
const IDLE_DEBOUNCE_MS = 240;

// A persisted anchor older than this is treated as stale (left behind by a crash
// or a turn that ended while the tab was closed) and discarded, so we never show
// a bogus "16m" the first time a conversation becomes busy again.
const MAX_ANCHOR_AGE_MS = 30 * 60 * 1000;

function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

// Only real conversations persist their anchor. A not-yet-saved conversation has
// no id, so it uses an in-memory start and can never inherit another chat's time.
function readAnchor(convId: string | undefined): number | null {
  if (!convId) return null;
  try {
    const stored = localStorage.getItem(startKey(convId));
    const n = stored ? Number(stored) : NaN;
    if (Number.isFinite(n) && n > 0 && Date.now() - n < MAX_ANCHOR_AGE_MS) return n;
  } catch { /* ignore storage errors */ }
  return null;
}

function writeAnchor(convId: string | undefined, value: number) {
  if (!convId) return;
  try { localStorage.setItem(startKey(convId), String(value)); } catch { /* ignore */ }
}

function clearAnchor(convId: string | undefined) {
  if (!convId) return;
  try { localStorage.removeItem(startKey(convId)); } catch { /* ignore */ }
}

export function TurnStatus({
  engine,
  convId,
  generating,
  label,
  thinking,
  contextUsed,
  contextLimit,
}: {
  engine: ChatEngine;
  convId?: string;
  generating: boolean;
  label: string;
  /** Live reasoning transcript for the in-flight turn. When present while busy,
   *  the line becomes expandable and doubles as the thinking surface — there's
   *  no separate live ThinkingBlock above the message. */
  thinking?: string;
  contextUsed?: number;
  contextLimit?: number;
}) {
  // Debounced "busy" — the source of truth for what the line shows. Rising edge
  // is immediate; falling edge waits out IDLE_DEBOUNCE_MS so phase-gap flaps
  // never surface as a flicker to "ready".
  const [busy, setBusy] = useState(generating);
  useEffect(() => {
    if (generating) { setBusy(true); return; }
    const t = setTimeout(() => setBusy(false), IDLE_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [generating]);

  // Timer anchor. prevBusy starts false so a mount that is already mid-turn
  // (a refresh during generation) is treated as an idle→busy edge and adopts
  // the persisted anchor instead of restarting the clock.
  const [start, setStart] = useState<number | null>(null);
  const prevBusy = useRef(false);
  const prevLabel = useRef(label);
  useEffect(() => {
    if (busy && !prevBusy.current) {
      const anchor = readAnchor(convId) ?? Date.now();
      writeAnchor(convId, anchor);
      setStart(anchor);
      prevLabel.current = label;
    } else if (busy && prevLabel.current !== label) {
      const anchor = Date.now();
      writeAnchor(convId, anchor);
      setStart(anchor);
      prevLabel.current = label;
    } else if (!busy && prevBusy.current) {
      clearAnchor(convId);
      setStart(null);
      prevLabel.current = label;
    }
    prevBusy.current = busy;
  }, [busy, convId, label]);

  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!busy) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [busy]);

  // Expandable only while a live turn is actually producing reasoning. Once the
  // turn ends the transcript settles into the message's own historical block, so
  // the caret disappears and the line returns to a plain idle indicator.
  const hasThinking = busy && !!thinking && thinking.trim().length > 0;
  const [expanded, setExpanded] = useState(false);
  useEffect(() => { if (!hasThinking) setExpanded(false); }, [hasThinking]);

  // Fall back to `now` for the one frame before the anchor effect runs, so the
  // line never flashes "ready" at the very start of a turn.
  const effectiveStart = busy ? (start ?? now) : null;
  const showTimer = effectiveStart != null;

  const row = (
    <div className="flex items-center gap-2">
      <EngineGlyph engine={engine} state={busy ? "busy" : "idle"} />
      <span className="text-sm text-gray-400 dark:text-gray-500">
        {showTimer ? (
          <span className="inline-flex items-baseline">
            {/* Only the phase word animates on change — the ticking elapsed time
                stays put, so it doesn't re-animate every second. The word slides
                up/out and the next slides in (a subtle flip, not an instant swap). */}
            <span className="relative inline-flex overflow-hidden h-[1.25em] items-baseline">
              <AnimatePresence mode="wait" initial={false}>
                <motion.span
                  key={label}
                  initial={{ y: "0.9em", opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  exit={{ y: "-0.9em", opacity: 0 }}
                  transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
                  className="whitespace-nowrap"
                >
                  {label}
                </motion.span>
              </AnimatePresence>
            </span>
            <span className="tabular-nums">&nbsp;· {formatElapsed(now - (effectiveStart ?? now))}</span>
          </span>
        ) : (
          "Ready"
        )}
      </span>
      {hasThinking && (
        <motion.span
          animate={{ rotate: expanded ? 90 : 0 }}
          transition={{ duration: 0.14 }}
          className="flex-shrink-0 text-gray-400 dark:text-gray-600"
        >
          <Collapse size="xs" />
        </motion.span>
      )}
      <ContextMeter used={contextUsed} limit={contextLimit} />
    </div>
  );

  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: "easeOut" }}
      className="pt-3 pb-1 select-none"
    >
      {hasThinking ? (
        <Button
          variant="ghost"
          onClick={() => setExpanded((v) => !v)}
          className="h-auto justify-start transition-opacity hover:opacity-80"
        >
          {row}
        </Button>
      ) : (
        row
      )}

      {/* Live reasoning transcript — same treatment as the historical block. */}
      <AnimatePresence initial={false}>
        {hasThinking && expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18, ease: "easeOut" }}
            className="overflow-hidden"
          >
            <div className="mt-1 max-h-56 overflow-y-auto" style={{ scrollbarWidth: "none" }}>
              <p className="font-mono text-2xs leading-relaxed whitespace-pre-wrap text-gray-400 dark:text-gray-600">
                {thinking}
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
