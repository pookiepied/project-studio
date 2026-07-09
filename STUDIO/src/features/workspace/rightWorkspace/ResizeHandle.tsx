import type { MouseEvent } from "react";

interface ResizeHandleProps {
  onMouseDown: (event: MouseEvent) => void;
}

export function ResizeHandle({ onMouseDown }: ResizeHandleProps) {
  return (
    <div
      onMouseDown={onMouseDown}
      className="group relative w-2 flex-shrink-0 cursor-col-resize outline-none"
      role="separator"
      aria-orientation="vertical"
    >
      <div className="absolute inset-y-0 right-0 w-px bg-gray-200/60 transition-colors duration-100 group-hover:bg-gray-300/80 dark:bg-white/[0.06] dark:group-hover:bg-white/[0.12]" />
    </div>
  );
}
