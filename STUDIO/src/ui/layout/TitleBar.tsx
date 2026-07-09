import { MagnifyingGlassIcon as Search } from "@phosphor-icons/react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useCommandPalette } from "@/app/contexts/CommandPaletteContext";
import { logger } from "@/core/logging/logger";
import { environmentService } from "@/core/platform/environmentService";
import { NavToggleIcon } from "../icons/WorkspaceIcons";
import { NotificationBell } from "../notifications/NotificationBell";

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
      className="relative flex h-10 select-none items-center justify-between border-b border-gray-900/[0.06] bg-gray-50 px-2.5 transition-colors duration-300 dark:border-white/[0.04] dark:bg-surface-page"
    >
      <button
        type="button"
        onClick={() => openPalette(true)}
        aria-label="Search or jump to (Ctrl+K)"
        className="absolute left-1/2 flex h-6 w-[430px] max-w-[50vw] -translate-x-1/2 items-center gap-1.5 rounded-full bg-gray-900/[0.04] px-3 text-gray-400 transition-colors duration-150 hover:bg-gray-900/[0.07] dark:bg-white/[0.04] dark:text-gray-500 dark:hover:bg-white/[0.07]"
      >
        <Search size={12} className="flex-shrink-0" />
        <span className="flex-1 truncate text-left text-xs">Search or jump to...</span>
        <kbd className="flex items-center gap-0.5 rounded border border-gray-300/60 px-1.5 py-0.5 font-sans text-3xs dark:border-white/10">
          <CommandIcon size={9} />
          K
        </kbd>
      </button>

      <div className="flex items-center gap-1.5">
        <button
          type="button"
          data-nav-toggle
          onClick={onToggle}
          className={`rounded-md p-1.5 transition-colors duration-150 ${
            navOpen
              ? "bg-gray-900/[0.07] text-gray-700 dark:bg-white/[0.07] dark:text-gray-200"
              : "text-gray-500 hover:bg-gray-900/[0.06] dark:text-gray-500 dark:hover:bg-white/[0.06]"
          }`}
          aria-label={navOpen ? "Close navigation" : "Open navigation"}
        >
          <NavToggleIcon open={navOpen} />
        </button>
      </div>

      <div className="flex items-center gap-1">
        <NotificationBell align="right" size={13} />

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
              <button
                key={label}
                type="button"
                onClick={action}
                aria-label={label}
                title={label}
                className="rounded-full transition-opacity hover:opacity-80 active:opacity-60"
                style={{
                  width: 12,
                  height: 12,
                  backgroundColor: color,
                  boxShadow: "inset 0 0 0 0.5px rgba(0,0,0,0.18)",
                }}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
