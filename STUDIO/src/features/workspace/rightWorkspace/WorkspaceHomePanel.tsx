import { useRef, type MouseEvent as ReactMouseEvent } from "react";
import {
  ChatCircleTextIcon as ChatCircleText,
  FilesIcon as Files,
  GlobeIcon as Globe,
  TerminalIcon as Terminal,
  XIcon as X,
} from "@phosphor-icons/react";
import { ResizeHandle } from "@/features/workspace/rightWorkspace/ResizeHandle";
import type { RightWorkspaceView } from "./types";
import { IconButton } from "@/ui/primitives/IconButton";
import { Button } from "@/ui/primitives/Button";

interface WorkspaceHomePanelProps {
  width: number;
  onWidthChange: (width: number) => void;
  onClose: () => void;
  onOpenView: (view: RightWorkspaceView) => void;
}

const ITEMS: Array<{
  view: Extract<RightWorkspaceView, "browser" | "terminal" | "files" | "side-chat">;
  label: string;
  shortcut?: string;
  Icon: typeof Terminal;
}> = [
  { view: "browser", label: "Browser", shortcut: "Ctrl+T", Icon: Globe },
  { view: "terminal", label: "Terminal", Icon: Terminal },
  { view: "side-chat", label: "Side chat", shortcut: "Ctrl+Alt+S", Icon: ChatCircleText },
  { view: "files", label: "Files", shortcut: "Ctrl+P", Icon: Files },
];

export function WorkspaceHomePanel({
  width,
  onWidthChange,
  onClose,
  onOpenView,
}: WorkspaceHomePanelProps) {
  const drag = useRef<{ sx: number; sw: number } | null>(null);

  const onResizeDown = (e: ReactMouseEvent) => {
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
            aria-label="Close workspace"
            title="Close workspace"
            className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg text-gray-400 transition-colors duration-150 hover:bg-gray-100 hover:text-gray-700 dark:text-gray-600 dark:hover:bg-surface-raised dark:hover:text-gray-300"
          >
            <X size={14} weight="bold" />
          </IconButton>
          <span className="truncate text-xs text-gray-500 dark:text-gray-500">Workspace</span>
        </div>

        <div className="mt-auto mb-auto px-6">
          <div className="space-y-2">
            {ITEMS.map(({ view, label, shortcut, Icon }) => (
              <Button
                key={view}
                variant="ghost"
                onClick={() => onOpenView(view)}
                className="flex h-10 w-full items-center gap-3 rounded-md bg-gray-100 px-3 text-left justify-start text-sm text-gray-700 transition-colors duration-100 hover:bg-gray-200/70 dark:bg-surface-raised dark:text-gray-300 dark:hover:bg-surface-selected"
              >
                <Icon size={14} weight="regular" className="flex-shrink-0 text-gray-500 dark:text-gray-500" />
                <span className="min-w-0 flex-1 truncate">{label}</span>
                {shortcut && (
                  <kbd className="flex-shrink-0 rounded bg-white/80 px-1.5 py-0.5 text-2xs text-gray-400 dark:bg-white/[0.06] dark:text-gray-500">
                    {shortcut}
                  </kbd>
                )}
              </Button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
