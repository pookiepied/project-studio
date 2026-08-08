/**
 * Browse-mode cards for the bundled/installable MCP servers:
 * Context7.
 *
 * These appear in the main "Apps" discovery grid (not the Manage panel).
 * Card chrome, status, and controls are strict-neutral (D-401); the bundled
 * server marks are monochrome (no brand colour).
 */
import { PlayIcon as Play, StopIcon as Stop } from "@/ui/icons";
import { Icon } from "@/ui/icons";
import { Toggle } from "@/ui/primitives/Toggle";
import { Button } from "@/ui/primitives/Button";
import type { McpServer } from "@/core/mcpRegistry/registryClient";
import {
  DotState, StatusDot,
  Context7Icon,
} from "./ExtensionIcons";

// ─── Shared inline-action row ─────────────────────────────────────────────────
const StartStopRow = ({ isTauri, isEnabled, isRunning, onStart, onStop }: {
  isTauri?: boolean; isEnabled: boolean; isRunning?: boolean;
  onStart?: () => void; onStop?: () => void;
}) => {
  if (!isTauri || !isEnabled) return null;
  return (
    <Button
      variant="ghost"
      onClick={isRunning ? onStop : onStart}
      className="flex items-center gap-1 px-2 py-0.5 text-xs font-medium h-auto bg-surface-raised rounded-md"
    >
      <Icon icon={isRunning ? Stop : Play} size="xs" weight="fill" />{isRunning ? "Stop" : "Start"}
    </Button>
  );
};

// ─── Shared toggle row ────────────────────────────────────────────────────────
const ToggleRow = ({ isEnabled, onToggle }: { isEnabled: boolean; onToggle?: () => void }) => (
  <Toggle
    size="sm"
    checked={isEnabled}
    onChange={() => onToggle?.()}
    aria-label={isEnabled ? "Disable" : "Enable"}
  />
);

// ─── Shared browse card wrapper ───────────────────────────────────────────────
const BrowseCard = ({ children, onClick }: { children: React.ReactNode; onClick?: () => void }) => (
  <div
    onClick={onClick}
    className="cursor-pointer border border-surface-border rounded-2xl p-3 flex flex-col gap-2.5 bg-surface-base hover:bg-surface-hover hover:shadow-sm transition-all"
  >
    {children}
  </div>
);

// ─── Status label ─────────────────────────────────────────────────────────────
const StatusLabel = ({ dotState, text }: { dotState: DotState; text: string }) => (
  <div className="flex items-center gap-1.5">
    <StatusDot state={dotState} />
    <span className="text-2xs text-muted">{text}</span>
  </div>
);

// ─── Context7 ─────────────────────────────────────────────────────────────────
export const Context7BrowseCard = ({
  installed, server, isRunning, isTauri, onClick, onStart, onStop, onToggle,
}: {
  installed: boolean; server?: McpServer; isRunning?: boolean; isTauri?: boolean;
  onClick?: () => void; onStart?: () => void; onStop?: () => void; onToggle?: () => void;
}) => {
  const isEnabled = server?.enabled ?? false;
  const dotState: DotState = isRunning ? "running" : isEnabled ? "stopped" : "disabled";
  return (
    <BrowseCard onClick={onClick}>
      <div className="flex items-center justify-between">
        <div className="w-8 h-8 rounded-xl bg-surface-base border border-surface-border shadow-sm flex items-center justify-center">
          <Context7Icon size={16} className="text-secondary" />
        </div>
        {installed && (
          <StatusLabel dotState={dotState} text={isRunning ? "Running" : isEnabled ? "Stopped" : "Disabled"} />
        )}
      </div>
      <div>
        <p className="text-sm font-semibold text-primary leading-tight">Context7</p>
        <p className="text-xs text-muted mt-0.5">by Upstash</p>
      </div>
      <p className="text-xs text-muted leading-relaxed line-clamp-2">
        Pulls live, version-accurate library docs into every chat. No stale examples.
      </p>
      {installed && (
        <div className="flex items-center gap-2 pt-2 border-t border-surface-divider" onClick={e => e.stopPropagation()}>
          <StartStopRow isTauri={isTauri} isEnabled={isEnabled} isRunning={isRunning} onStart={onStart} onStop={onStop} />
          <ToggleRow isEnabled={isEnabled} onToggle={onToggle} />
        </div>
      )}
    </BrowseCard>
  );
};
