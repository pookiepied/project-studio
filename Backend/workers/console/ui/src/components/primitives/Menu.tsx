import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { Check, ChevronDown } from "lucide-react";
import { DURATION, EASE_OUT } from "../../design/tokens";
import { cn } from "../../lib/cn";

/**
 * A menu anchored to its trigger.
 *
 * Hand-written rather than pulled from a component library, and that is a
 * decision rather than an omission — the same one STUDIO made. Every menu here
 * is the same shape: a short list, opened by one control, closed by Escape or a
 * click outside, placed along one axis. A headless library brings a full
 * collision-aware floating engine to solve that, plus styling that has to be
 * overridden back to these tokens anyway.
 *
 * ---- Why it renders in a portal -------------------------------------------
 *
 * The obvious construction is `position: absolute` inside the trigger's own
 * box, and it is wrong the moment a trigger sits inside anything that scrolls
 * or clips. Ours do: every menu in this console opens inside a `Panel`, which is
 * `overflow-hidden` so its rows can have square corners against a rounded
 * shell. An absolutely positioned panel would be cut off by the card that
 * contains it — which looks like a bug in the menu and is not one.
 *
 * A portal to `document.body` removes the whole class of problem: nothing can
 * clip an element that is not inside it. The position is measured from the
 * trigger's rect and pinned with `position: fixed`.
 *
 * ---- Why the panel is measured with offsetWidth, not its rect --------------
 *
 * The panel animates in with a `scale(0.97)` transform, and
 * `getBoundingClientRect` reports the *transformed* box. Measuring that places
 * the panel against a box 3% smaller than the one that will be on screen a
 * frame later, and for a right-aligned menu the whole error lands on the left
 * edge — so the panel opens a few pixels off and snaps into place on the first
 * reposition. `offsetWidth`/`offsetHeight` are layout sizes the transform never
 * touches, so the measurement and the settled panel are the same box.
 */

const OFFSET = 6;
const MARGIN = 8;

interface Placement {
  top: number;
  left: number;
  /** Set when the panel flipped above its trigger, so the origin can follow. */
  above: boolean;
}

export function Menu({
  trigger,
  children,
  align = "start",
  ariaLabel,
  className,
}: {
  /** Rendered inside the trigger button. */
  trigger: ReactNode;
  children: (close: () => void) => ReactNode;
  align?: "start" | "end";
  ariaLabel: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [place, setPlace] = useState<Placement | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const position = useCallback(() => {
    const t = triggerRef.current;
    const p = panelRef.current;
    if (!t || !p) return;

    const rect = t.getBoundingClientRect();
    const w = p.offsetWidth;
    const h = p.offsetHeight;

    const below = rect.bottom + OFFSET;
    const above = window.innerHeight - rect.top + OFFSET;
    // Flip up only when there is genuinely not room below, so a menu near the
    // bottom of a short window does not open off-screen.
    const flip = below + h > window.innerHeight - MARGIN && above + h < window.innerHeight - MARGIN;

    let left = align === "end" ? rect.right - w : rect.left;
    left = Math.min(Math.max(left, MARGIN), window.innerWidth - w - MARGIN);

    setPlace({ top: flip ? rect.top - OFFSET - h : below, left, above: flip });
  }, [align]);

  useLayoutEffect(() => {
    if (open) position();
  }, [open, position]);

  useEffect(() => {
    if (!open) return;

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (panelRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      setOpen(false);
    };

    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onDown);
    // A menu whose trigger scrolls away should follow it, not hang in place.
    window.addEventListener("scroll", position, true);
    window.addEventListener("resize", position);

    // A menu whose own content resizes — a list that filters as you type —
    // changes its box without closing, and a position computed for the old box
    // is wrong for the new one. Guarded, because a menu that keeps its first
    // position beats one that fails to open at all.
    const observer =
      typeof ResizeObserver !== "undefined" ? new ResizeObserver(position) : null;
    if (panelRef.current && observer) observer.observe(panelRef.current);

    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("scroll", position, true);
      window.removeEventListener("resize", position);
      observer?.disconnect();
    };
  }, [open, position]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={ariaLabel}
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "text-ui inline-flex h-(--control-md) items-center gap-1.5 rounded-lg px-2.5",
          "border border-hairline bg-surface-sunken outline-none",
          "transition-colors duration-fast hover:border-foreground/20",
          className,
        )}
      >
        {trigger}
        <ChevronDown
          className="mark transition-transform duration-fast"
          strokeWidth={1.75}
          style={{ transform: open ? "rotate(180deg)" : undefined }}
        />
      </button>

      {createPortal(
        <AnimatePresence>
          {open ? (
            <motion.div
              ref={panelRef}
              role="menu"
              aria-label={ariaLabel}
              initial={{ opacity: 0, scale: 0.97 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.97 }}
              transition={{ duration: DURATION.fast, ease: EASE_OUT }}
              style={{
                position: "fixed",
                top: place?.top ?? -9999,
                left: place?.left ?? -9999,
                transformOrigin: place?.above ? "bottom" : "top",
              }}
              className={cn(
                "z-50 min-w-40 rounded-xl border border-hairline bg-surface-raised p-1",
                "shadow-lifted",
                // Hidden until measured, so the first paint is never in the
                // wrong place. Opacity rather than `display`, because the panel
                // has to be laid out to be measured at all.
                place ? "visible" : "invisible",
              )}
            >
              {children(() => setOpen(false))}
            </motion.div>
          ) : null}
        </AnimatePresence>,
        document.body,
      )}
    </>
  );
}

/**
 * One row of a menu.
 *
 * The check column is reserved rather than conditional: a check that appears
 * and pushes the label sideways makes the whole menu twitch as the selection
 * moves.
 */
export function MenuItem({
  onSelect,
  selected = false,
  children,
}: {
  onSelect: () => void;
  selected?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      role="menuitemradio"
      aria-checked={selected}
      onClick={onSelect}
      className={cn(
        "text-ui flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left",
        "transition-colors duration-fast hover:bg-tint hover:text-foreground",
        selected ? "text-foreground" : "text-muted-foreground",
      )}
    >
      {/* One line tall, so the mark centres on the row's first line whatever
          the label's leading turns out to be. A derived height survives a
          change to the type scale; a hand-tuned margin does not. */}
      <span className="flex h-[1lh] w-[1.1em] shrink-0 items-center justify-center">
        {selected ? <Check className="mark" strokeWidth={2} /> : null}
      </span>
      <span className="min-w-0 flex-1 truncate">{children}</span>
    </button>
  );
}
