import type { MouseEvent } from "react";

interface ResizeHandleProps {
  onMouseDown: (event: MouseEvent) => void;
}

export function ResizeHandle({ onMouseDown }: ResizeHandleProps) {
  return (
    <div
      onMouseDown={onMouseDown}
      className="group relative w-3 flex-shrink-0 cursor-col-resize outline-none"
      role="separator"
      aria-orientation="vertical"
    >
      <div className="absolute left-1/2 top-1/2 h-16 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full bg-surface-border/0 transition-colors duration-150 group-hover:bg-surface-border/80" />
    </div>
  );
}
