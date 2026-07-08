import { useRef, useState, useLayoutEffect } from "react";
import { CaretDownIcon as CaretDown } from "@phosphor-icons/react";

const COLLAPSED_MAX = 200; // px — height cap while collapsed (~9 lines)
const OVERFLOW_SLOP = 28;  // px — only collapse if content meaningfully exceeds the cap

/**
 * Renders a user message's text. When the text is long it clamps to a fixed
 * height with a fade/blur at the bottom and a "Show more" / "Show less" toggle,
 * mirroring the way ChatGPT collapses pasted text.
 */
export function CollapsibleUserText({ content }: { content: string }) {
  const textRef = useRef<HTMLParagraphElement>(null);
  const [expanded,    setExpanded]    = useState(false);
  const [overflowing, setOverflowing] = useState(false);
  const [fullHeight,  setFullHeight]  = useState(0);

  // Measure the natural height to decide whether to clamp, and to animate to an
  // exact pixel height when expanding (so the transition is smooth both ways).
  useLayoutEffect(() => {
    const el = textRef.current;
    if (!el) return;
    const h = el.scrollHeight;
    setFullHeight(h);
    setOverflowing(h > COLLAPSED_MAX + OVERFLOW_SLOP);
  }, [content]);

  const maxHeight = !overflowing
    ? undefined
    : expanded
    ? fullHeight
    : COLLAPSED_MAX;

  return (
    <div className="flex flex-col">
      {/* Clamp container — animates real height, never scales (no text stretch) */}
      <div
        style={{
          position:   "relative",
          maxHeight,
          overflow:   "hidden",
          transition: "max-height 0.3s cubic-bezier(0.16, 1, 0.3, 1)",
        }}
      >
        <p
          ref={textRef}
          className="text-sm font-normal leading-relaxed whitespace-pre-wrap"
        >
          {content}
        </p>

        {/* Fade + blur veil — only while collapsed */}
        {overflowing && !expanded && (
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 bottom-0 h-16
                       bg-gradient-to-t from-gray-100 dark:from-surface-raised to-transparent
                       backdrop-blur-[1.5px] [mask-image:linear-gradient(to_top,black,transparent)]"
          />
        )}
      </div>

      {/* Toggle */}
      {overflowing && (
        <button
          type="button"
          onClick={() => setExpanded(v => !v)}
          className="self-start mt-1.5 flex items-center gap-1 text-sm font-medium
                     text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200
                     transition-colors duration-150"
        >
          {expanded ? "Show less" : "Show more"}
          <CaretDown
            size={11}
            weight="bold"
            className="transition-transform duration-200"
            style={{ transform: expanded ? "rotate(180deg)" : "rotate(0deg)" }}
          />
        </button>
      )}
    </div>
  );
}
