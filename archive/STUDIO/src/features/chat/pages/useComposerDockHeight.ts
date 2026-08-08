import { useEffect, useRef, useState } from "react";

export function useComposerDockHeight(dependencyKey: unknown, initialHeight = 132) {
  const composerDockRef = useRef<HTMLDivElement>(null);
  const [composerDockHeight, setComposerDockHeight] = useState(initialHeight);

  useEffect(() => {
    const el = composerDockRef.current;
    if (!el) return;

    let raf = 0;
    const measure = () => {
      const h = el.offsetHeight;
      setComposerDockHeight((prev) => (Math.abs(prev - h) > 1 ? h : prev));
    };

    const resizeObserver = new ResizeObserver(() => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(measure);
    });

    resizeObserver.observe(el);
    measure();

    return () => {
      cancelAnimationFrame(raf);
      resizeObserver.disconnect();
    };
  }, [dependencyKey]);

  return { composerDockRef, composerDockHeight };
}
