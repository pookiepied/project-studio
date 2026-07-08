import { useEffect, type RefObject } from "react";

/**
 * Calls `handler` when a mousedown event fires outside the given element.
 * Also calls `handler` when Escape is pressed.
 */
export function useOnClickOutside<T extends HTMLElement>(
  ref:     RefObject<T | null>,
  handler: () => void,
  enabled  = true
) {
  useEffect(() => {
    if (!enabled) return;

    const onMouse = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) handler();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") handler();
    };

    document.addEventListener("mousedown", onMouse);
    document.addEventListener("keydown",   onKey);
    return () => {
      document.removeEventListener("mousedown", onMouse);
      document.removeEventListener("keydown",   onKey);
    };
  }, [ref, handler, enabled]);
}
