/**
 * TurnStatus is the single status line at the foot of a conversation.
 * It stays mounted and morphs between idle and busy phases so phase handoffs do
 * not briefly flash the idle state.
 */

import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Collapse } from "@/ui/icons";
import type { ChatEngine } from "@/cliBridges/types";
import { EngineGlyph } from "./EngineGlyph";
import { ContextMeter } from "./ContextMeter";
import { Button } from "@/ui/primitives/Button";

const startKey = (convId: string) => `studio.genstart.${convId}`;
const IDLE_DEBOUNCE_MS = 240;
const MAX_ANCHOR_AGE_MS = 30 * 60 * 1000;

function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

function readAnchor(convId: string | undefined): number | null {
  if (!convId) return null;
  try {
    const stored = localStorage.getItem(startKey(convId));
    const n = stored ? Number(stored) : NaN;
    if (Number.isFinite(n) && n > 0 && Date.now() - n < MAX_ANCHOR_AGE_MS) return n;
  } catch {
    // Ignore storage errors.
  }
  return null;
}

function writeAnchor(convId: string | undefined, value: number) {
  if (!convId) return;
  try {
    localStorage.setItem(startKey(convId), String(value));
  } catch {
    // Ignore storage errors.
  }
}

function clearAnchor(convId: string | undefined) {
  if (!convId) return;
  try {
    localStorage.removeItem(startKey(convId));
  } catch {
    // Ignore storage errors.
  }
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
  thinking?: string;
  contextUsed?: number;
  contextLimit?: number;
}) {
  const [busy, setBusy] = useState(generating);
  useEffect(() => {
    if (generating) {
      setBusy(true);
      return;
    }
    const t = setTimeout(() => setBusy(false), IDLE_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [generating]);

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

  const hasThinking = busy && !!thinking && thinking.trim().length > 0;
  const [expanded, setExpanded] = useState(false);
  useEffect(() => {
    if (!hasThinking) setExpanded(false);
  }, [hasThinking]);

  const engineLabel = engine === "claude" ? "Claude" : "Studio";
  const effectiveStart = busy ? (start ?? now) : null;
  const showTimer = effectiveStart != null;

  const row = (
    <div className="flex items-center gap-2">
      <EngineGlyph engine={engine} state={busy ? "busy" : "idle"} />
      <span className="text-sm text-disabled dark:text-muted">
        {showTimer ? (
          <span className="inline-flex items-baseline">
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
            <span className="tabular-nums">&nbsp;- {formatElapsed(now - (effectiveStart ?? now))}</span>
          </span>
        ) : (
          `${engineLabel} is ready for your next task`
        )}
      </span>
      {hasThinking && (
        <motion.span
          animate={{ rotate: expanded ? 90 : 0 }}
          transition={{ duration: 0.14 }}
          className="flex-shrink-0 text-disabled dark:text-secondary"
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
              <p className="font-mono text-2xs leading-relaxed whitespace-pre-wrap text-disabled dark:text-secondary">
                {thinking}
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
