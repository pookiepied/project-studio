import { Search } from "@/ui/icons";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useCommandPalette } from "@/app/contexts/CommandPaletteContext";
import { logger } from "@/core/logging/logger";
import { environmentService } from "@/core/platform/environmentService";
import { NavToggleIcon } from "@/ui/icons/WorkspaceIcons";
import { NotificationBell } from "@/app/shell/NotificationBell";
import { IconButton } from "@/ui/primitives/IconButton";

interface TitleBarProps {
  onToggle: () => void;
  navOpen?: boolean;
}

const CommandIcon = ({ size = 11 }: { size?: number }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M18 3a3 3 0 0 0-3 3v12a3 3 0 0 0 3 3 3 3 0 0 0 3-3 3 3 0 0 0-3-3H6a3 3 0 0 0-3 3 3 3 0 0 0 3 3 3 3 0 0 0 3-3V6a3 3 0 0 0-3-3 3 3 0 0 0-3 3 3 3 0 0 0 3 3h12a3 3 0 0 0 3-3 3 3 0 0 0-3-3z" />
  </svg>
);

export const TitleBar = ({ onToggle, navOpen = false }: TitleBarProps) => {
  const { setOpen: openPalette } = useCommandPalette();

  const handleMinimize = async () => {
    if (!environmentService.isTauri()) return;
    try {
      await getCurrentWindow().minimize();
    } catch (error) {
      logger.error("TitleBar", "Failed to minimize window", error);
    }
  };

  const handleMaximize = async () => {
    if (!environmentService.isTauri()) return;
    try {
      await getCurrentWindow().toggleMaximize();
    } catch (error) {
      logger.error("TitleBar", "Failed to maximize window", error);
    }
  };

  const handleClose = async () => {
    if (!environmentService.isTauri()) return;
    try {
      await getCurrentWindow().close();
    } catch (error) {
      logger.error("TitleBar", "Failed to close window", error);
    }
  };

  const showWindowControls = environmentService.isTauri();

  return (
    <div
      data-tauri-drag-region={environmentService.isTauri() ? "" : undefined}
      className="relative flex h-10 select-none items-center justify-between border-b border-primary/[0.06] bg-surface-page px-2.5 transition-colors duration-300 dark:border-white/[0.04] dark:bg-surface-page"
    >
      <IconButton
        onClick={() => openPalette(true)}
        aria-label="Search or jump to (Ctrl+K)"
        className="absolute left-1/2 -translate-x-1/2 h-6 w-[430px] max-w-[50vw] gap-1.5 rounded-full bg-primary/[0.04] px-3 text-disabled hover:bg-primary/[0.07] dark:bg-surface-page/[0.04] dark:text-muted dark:hover:bg-surface-page/[0.07]"
      >
        <Search size="sm" className="flex-shrink-0" />
        <span className="flex-1 truncate text-left text-xs">Search or jump to...</span>
        <kbd className="flex items-center gap-0.5 rounded border border-surface-border/60 px-1.5 py-0.5 font-sans text-3xs dark:border-surface-border">
          <CommandIcon size={12} />
          K
        </kbd>
      </IconButton>

      <div className="flex items-center gap-1.5">
        <IconButton
          data-nav-toggle
          variant="ghost"
          onClick={onToggle}
          className={`h-auto w-auto rounded-md p-1.5 ${
            navOpen
              ? "bg-primary/[0.07] text-secondary dark:bg-surface-page/[0.07] dark:text-disabled"
              : "text-muted hover:bg-primary/[0.06] dark:text-muted dark:hover:bg-surface-page/[0.06]"
          }`}
          aria-label={navOpen ? "Close navigation" : "Open navigation"}
        >
          <NavToggleIcon open={navOpen} />
        </IconButton>
      </div>

      <div className="flex items-center gap-1">
        <NotificationBell align="right" size="sm" />

        {showWindowControls && (
          <div className="flex items-center" style={{ gap: 8 }}>
            {([
              /* macOS traffic-light hues — fixed OS-chrome colours, not themeable design tokens */
              /* eslint-disable no-restricted-syntax */
              { color: "#FF5F57", label: "Close",    action: handleClose },
              { color: "#FFBD2E", label: "Minimize", action: handleMinimize },
              { color: "#28C840", label: "Zoom",     action: handleMaximize },
              /* eslint-enable no-restricted-syntax */
            ] as const).map(({ color, label, action }) => (
              <IconButton
                key={label}
                onClick={action}
                aria-label={label}
                className="rounded-full ring-1 ring-surface-border transition-opacity hover:opacity-80 active:opacity-60"
                style={{
                  width: 12,
                  height: 12,
                  backgroundColor: color,
                }}
              >
                {null}
              </IconButton>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
