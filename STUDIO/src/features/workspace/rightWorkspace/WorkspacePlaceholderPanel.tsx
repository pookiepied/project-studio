import { useRef } from "react";
import {
  ChatCircleTextIcon as ChatCircleText,
  FilesIcon as Files,
  XIcon as X,
} from "@phosphor-icons/react";
import { ResizeHandle } from "@/features/workspace/rightWorkspace/ResizeHandle";
import type { RightWorkspaceView } from "./types";
import { IconButton } from "@/ui/primitives/IconButton";

interface WorkspacePlaceholderPanelProps {
  view: Extract<RightWorkspaceView, "files" | "side-chat">;
  width: number;
  onWidthChange: (width: number) => void;
  onClose: () => void;
}

export function WorkspacePlaceholderPanel({
  view,
  width,
  onWidthChange,
  onClose,
}: WorkspacePlaceholderPanelProps) {
  const drag = useRef<{ sx: number; sw: number } | null>(null);
  const Icon = view === "files" ? Files : ChatCircleText;
  const title = view === "files" ? "Files" : "Side chat";

  const onResizeDown = (e: React.MouseEvent) => {
    e.preventDefault();
    drag.current = { sx: e.clientX, sw: width };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    const onMove = (ev: MouseEvent) => {
      if (!drag.current) return;
      // Cap at half the window so the chat side always keeps >=50% (rail + text
      // get crushed otherwise); never exceed 1000 or drop below 340.
      const maxW = Math.max(340, Math.min(1000, Math.round(window.innerWidth * 0.5)));
      onWidthChange(Math.max(340, Math.min(maxW, drag.current.sw + (drag.current.sx - ev.clientX))));
    };
    const onUp = () => {
      drag.current = null;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  };

  return (
    <div className="flex h-full transition-colors duration-300" style={{ width, minWidth: width }}>
      <ResizeHandle onMouseDown={onResizeDown} />

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden bg-white transition-colors duration-300 dark:bg-surface-page">
        <div className="flex h-10 flex-shrink-0 items-center gap-2.5 border-b border-gray-100 bg-white px-3 transition-colors duration-300 dark:border-white/[0.06] dark:bg-surface-page">
          <IconButton
            size="sm"
            onClick={onClose}
            aria-label={`Close ${title.toLowerCase()}`}
            title={`Close ${title.toLowerCase()}`}
            className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg text-gray-400 transition-colors duration-150 hover:bg-gray-100 hover:text-gray-700 dark:text-gray-600 dark:hover:bg-surface-raised dark:hover:text-gray-300"
          >
            <X size={14} weight="bold" />
          </IconButton>
          <Icon size={14} weight="regular" className="flex-shrink-0 text-gray-400 dark:text-gray-600" />
          <span className="truncate text-xs text-gray-500 dark:text-gray-500">{title}</span>
        </div>

        <div className="flex flex-1 items-center justify-center px-8 text-center">
          <div className="max-w-[220px]">
            <div className="mx-auto mb-3 flex h-9 w-9 items-center justify-center rounded-lg border border-gray-200 bg-white text-gray-400 dark:border-surface-border dark:bg-surface-raised dark:text-gray-500">
              <Icon size={16} weight="regular" />
            </div>
            <p className="text-sm font-medium text-gray-600 dark:text-gray-400">{title}</p>
            <p className="mt-1 text-xs leading-relaxed text-gray-400 dark:text-gray-600">
              Nothing here yet.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
