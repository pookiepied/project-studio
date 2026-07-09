import { useCallback, useLayoutEffect, useRef } from "react";

const HEIGHT_ANIMATION_MS = 130;
const HEIGHT_EASING = "cubic-bezier(0.16, 1, 0.3, 1)";

/**
 * Grows a textarea to fit its content (ChatGPT-style) up to `maxHeight`, then
 * lets it scroll internally. Runs whenever `value` changes, so it grows as you
 * type and shrinks back when the field is cleared.
 *
 * Deliberately does NOT measure while a CSS height transition is active: a
 * running transition can corrupt the resize calculation. We set the real final
 * height immediately, then use a short Web Animation from the previous rendered
 * height to the new one for polish.
 *
 * @param ref        the textarea element ref
 * @param value      the controlled value (drives recomputation)
 * @param maxHeight  px cap before the textarea starts scrolling internally
 */
export function useAutoResizeTextarea(
  ref: React.RefObject<HTMLTextAreaElement | null>,
  value: string,
  maxHeight: number,
) {
  const frameRef = useRef<number | null>(null);
  const animationRef = useRef<Animation | null>(null);
  const hasMeasuredRef = useRef(false);

  const resizeElement = useCallback((el: HTMLTextAreaElement) => {
    const previousHeight = el.getBoundingClientRect().height;
    const shouldAnimate =
      hasMeasuredRef.current &&
      previousHeight > 0 &&
      typeof el.animate === "function" &&
      !window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    animationRef.current?.cancel();
    animationRef.current = null;

    el.style.maxHeight = `${maxHeight}px`;
    el.style.overflowY = "hidden";
    el.style.height = "0px";

    const fullHeight = el.scrollHeight;
    const minHeight = Number.parseFloat(window.getComputedStyle(el).minHeight) || 0;
    const nextHeight = Math.min(Math.max(fullHeight, minHeight), maxHeight);

    el.style.height = `${nextHeight}px`;
    el.style.overflowY = fullHeight > maxHeight ? "auto" : "hidden";

    if (shouldAnimate && Math.abs(previousHeight - nextHeight) > 1) {
      const animation = el.animate(
        [
          { height: `${previousHeight}px` },
          { height: `${nextHeight}px` },
        ],
        {
          duration: HEIGHT_ANIMATION_MS,
          easing: HEIGHT_EASING,
        },
      );

      animationRef.current = animation;
      const clearAnimation = () => {
        if (animationRef.current === animation) animationRef.current = null;
      };
      animation.addEventListener("finish", clearAnimation, { once: true });
      animation.addEventListener("cancel", clearAnimation, { once: true });
    }

    hasMeasuredRef.current = true;
  }, [maxHeight]);

  const scheduleResize = useCallback((el: HTMLTextAreaElement | null = ref.current) => {
    if (!el) return;

    if (frameRef.current !== null) {
      window.cancelAnimationFrame(frameRef.current);
    }

    frameRef.current = window.requestAnimationFrame(() => {
      frameRef.current = null;
      resizeElement(el);
    });
  }, [ref, resizeElement]);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;

    resizeElement(el);
    scheduleResize(el);

    return () => {
      if (frameRef.current !== null) {
        window.cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
    };
  }, [ref, resizeElement, scheduleResize, value]);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;

    const resizeMountedElement = () => resizeElement(el);
    const scheduleMountedElement = () => scheduleResize(el);

    el.addEventListener("input", resizeMountedElement);
    window.addEventListener("resize", scheduleMountedElement);

    let lastWidth = el.getBoundingClientRect().width;
    const observer = typeof ResizeObserver === "undefined"
      ? null
      : new ResizeObserver(([entry]) => {
        const nextWidth = entry?.contentRect.width ?? el.getBoundingClientRect().width;
        if (Math.abs(nextWidth - lastWidth) > 0.5) {
          lastWidth = nextWidth;
          scheduleMountedElement();
        }
      });

    observer?.observe(el);

    let cancelled = false;
    document.fonts?.ready.then(() => {
      if (!cancelled) scheduleMountedElement();
    });

    return () => {
      cancelled = true;
      observer?.disconnect();
      el.removeEventListener("input", resizeMountedElement);
      window.removeEventListener("resize", scheduleMountedElement);
    };
  }, [ref, resizeElement, scheduleResize]);
}
