import { useEffect, useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { getTurnAnchorIndices } from "@/lib/turnAnchors";
import type { ChatMessage } from "@/types";

interface Props {
  messages: ChatMessage[];
  containerRef: React.RefObject<HTMLDivElement | null>;
  /** px to inset the rail's bottom by, so it clears the floating composer */
  bottomInset?: number;
}

const SHOW_THRESHOLD = 3; // turns before the rail appears
const TICK_W        = 6;  // px — width of an inactive mark
const TICK_W_HOVER  = 9;  // px — width on hover
const TICK_W_ACTIVE = 14; // px — width of the active mark (extends sideways)
const TICK_H        = 2;  // px — height of each horizontal mark
const PITCH         = 13; // px — FIXED distance between consecutive ticks
const TRACK_PAD     = 10; // px — top/bottom padding within the track

export const ConversationRail = ({ messages, containerRef, bottomInset = 0 }: Props) => {
  const [trackEl,    setTrackEl]    = useState<HTMLDivElement | null>(null);
  const [trackH,     setTrackH]     = useState(0);
  const [activeIdx,  setActiveIdx]  = useState(0);
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);
  const [tooltipY,   setTooltipY]   = useState(0);

  // Turn anchors (first message + every user message) — shared with the message
  // list so ticks always map to current, visible content under deletion.
  const anchors = getTurnAnchorIndices(messages);
  const count   = anchors.length;

  // Measure the track height. Callback ref → re-runs whenever the track
  // mounts (i.e. when the rail crosses SHOW_THRESHOLD), not just on first render.
  useEffect(() => {
    if (!trackEl) return;
    const ro = new ResizeObserver(() => setTrackH(trackEl.clientHeight));
    ro.observe(trackEl);
    setTrackH(trackEl.clientHeight);
    return () => ro.disconnect();
  }, [trackEl]);

  // Highlight the newest turn whose anchor has crossed the reading line
  useEffect(() => {
    const c = containerRef.current;
    if (!c || count === 0) return;
    const onScroll = () => {
      const cTop = c.getBoundingClientRect().top;
      const readingLine = c.clientHeight * 0.4;
      let active = 0;
      for (let i = 0; i < count; i++) {
        const el = c.querySelector(`[data-turn-index="${i}"]`) as HTMLElement | null;
        if (!el) continue;
        const elTop = el.getBoundingClientRect().top - cTop;
        if (elTop <= readingLine) {
          active = i;
        } else {
          break;
        }
      }
      setActiveIdx(active);
    };
    c.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => c.removeEventListener("scroll", onScroll);
  }, [containerRef, count]);

  const scrollTo = useCallback((i: number) => {
    const el = containerRef.current?.querySelector(
      `[data-turn-index="${i}"]`
    ) as HTMLElement | null;
    el?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [containerRef]);

  const getLabel = (i: number) => {
    const words = (messages[anchors[i]]?.content ?? "").trim().split(/\s+/);
    return words.slice(0, 8).join(" ") + (words.length > 8 ? "…" : "");
  };

  // Fixed, uniform spacing — the distance between ticks is ALWAYS the same,
  // regardless of how long each turn is. Ticks anchor at the top and grow
  // downward as the conversation grows. Only when the column would overflow
  // do we compress the pitch just enough to fit.
  const usable = Math.max(0, trackH - TRACK_PAD * 2);
  const pitch = count > 1
    ? Math.min(PITCH, (usable - TICK_H) / (count - 1))
    : PITCH;

  const topFor = (i: number): number => i * pitch;

  return (
    <AnimatePresence>
      {count > SHOW_THRESHOLD && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.25 }}
          className="absolute z-10"
          // top clears the fixed window traffic lights (14/23 + radius) and the
          // floating dock — without this the rail's ticks render underneath /
          // overlapping the close/minimize/zoom buttons at the window's top-left.
          style={{ left: 8, top: 60, bottom: bottomInset, width: 16 }}
        >
          {/* Track container */}
          <div
            ref={setTrackEl}
            style={{ position: "absolute", top: TRACK_PAD, bottom: TRACK_PAD, left: 0, right: 0 }}
          >
            {trackH > 0 && anchors.map((_, i) => {
              const topPx    = topFor(i);
              const isActive = activeIdx  === i;
              const isHov    = hoveredIdx === i;

              // Use the app's own CSS variable palette — auto-switches in dark/light mode
              const tickColor = isActive
                ? "var(--text-primary)"
                : isHov
                ? "var(--text-secondary)"
                : "var(--text-muted)";

              return (
                <div
                  key={i}
                  role="button"
                  aria-label={`Jump to turn ${i + 1}`}
                  style={{
                    position: "absolute",
                    // No clamp — the hit-area extends 6px above the tick into the
                    // track padding. Clamping the first tick to 0 would shove its
                    // visible mark down by 6px and break the uniform spacing.
                    top:    topPx - 6,   // 6px hit-area above the tick
                    left:   0,
                    right:  0,
                    height: TICK_H + 12, // 6px hit-area above + below
                    cursor: "pointer",
                  }}
                  onClick={() => scrollTo(i)}
                  onMouseEnter={(e) => {
                    setHoveredIdx(i);
                    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                    setTooltipY(r.top + r.height / 2);
                  }}
                  onMouseLeave={() => setHoveredIdx(null)}
                >
                  {/* Horizontal tick mark — left edge is fixed; the active one
                      grows rightward only (left origin never moves) */}
                  <div
                    style={{
                      position:        "absolute",
                      top:             6,
                      left:            2,
                      width:           isActive ? TICK_W_ACTIVE : isHov ? TICK_W_HOVER : TICK_W,
                      height:          TICK_H,
                      borderRadius:    1,
                      backgroundColor: tickColor,
                      transition:      "width 0.24s cubic-bezier(0.16, 1, 0.3, 1), background-color 0.16s ease",
                    }}
                  />
                </div>
              );
            })}
          </div>

          {/* Tooltip — fixed to escape overflow:hidden parent */}
          <AnimatePresence>
            {hoveredIdx !== null && (
              <motion.div
                key={`tip-${hoveredIdx}`}
                initial={{ opacity: 0, x: -4 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.1 }}
                className="shadow-md"
                style={{
                  position:        "fixed",
                  left:            22,
                  top:             tooltipY,
                  transform:       "translateY(-50%)",
                  zIndex:          9999,
                  pointerEvents:   "none",
                  background:      "var(--surface-raised)",
                  border:          "1px solid var(--surface-border)",
                  borderRadius:    5,
                  padding:         "4px 9px",
                  fontSize:        "var(--text-xs)",
                  maxWidth:        220,
                  whiteSpace:      "nowrap",
                  overflow:        "hidden",
                  textOverflow:    "ellipsis",
                  color:           "var(--text-secondary)",
                }}
              >
                <span style={{ color: "var(--text-muted)", marginRight: 5, fontSize: "var(--text-2xs)" }}>
                  {hoveredIdx + 1}
                </span>
                {getLabel(hoveredIdx)}
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
