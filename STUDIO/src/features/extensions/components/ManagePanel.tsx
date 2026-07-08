/**
 * Manage panel — slides in over the main browse view.
 * Shows all installed servers and connected Composio apps with toggle/start/stop/remove controls.
 * Strict-neutral (D-401): server marks are monochrome, status reads on shade.
 */
import {
  PlayIcon as Play,
  StopIcon as Stop,
  TerminalIcon as Terminal,
} from "@phosphor-icons/react";
import { motion } from "framer-motion";
import { Back, Delete, Icon } from "@/components/icons";
import { AppLogo } from "@/components/brand";
import { Toggle } from "@/components/ui/Toggle";
import { IconButton } from "@/components/ui/IconButton";
import { EmptyState } from "@/components/ui/EmptyState";
import type { McpServer } from "@/services/ai/mcpService";
import type { ComposioApp, ComposioConnection } from "@/services/ai/composioService";
import {
  StatusDot, DotState,
  Context7Icon,
} from "./ExtensionIcons";

interface ManagePanelProps {
  onClose:                    () => void;
  isAuthenticated:            boolean;
  mcpLoading:                 boolean;
  isTauri:                    boolean;
  // Servers
  context7Server:             McpServer | undefined;
  context7Running:            boolean;
  customServers:              McpServer[];
  runningServers:             Set<string>;
  // Composio
  groupedComposioConnections: [string, ComposioConnection[]][];
  composioApps:               ComposioApp[];
  composioPolling:            Set<string>;
  // Handlers
  onMcpStart:            (server: McpServer) => void;
  onMcpStop:             (name: string) => void;
  onMcpToggle:           (name: string, enabled: boolean) => void;
  onMcpUninstall:        (name: string) => void;
  onComposioToggle:      (id: string, enabled: boolean) => void;
  onComposioDisconnect:  (id: string, appName: string) => void;
}

// ─── Reusable server row ───────────────────────────────────────────────────────
const ServerRow = ({ icon, name, dotState, status, isTauri, isEnabled, isRunning, isRemote, onStart, onStop, onToggle, onRemove }: {
  icon: React.ReactNode;
  name: string;
  dotState: DotState;
  status: string;
  isTauri: boolean;
  isEnabled: boolean;
  isRunning: boolean;
  isRemote?: boolean;
  onStart?: () => void;
  onStop?: () => void;
  onToggle?: () => void;
  onRemove: () => void;
}) => (
  <div className="flex items-center gap-3 px-3 py-2.5 bg-surface-base">
    <div className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 bg-surface-raised border border-surface-border">
      {icon}
    </div>
    <div className="flex-1 min-w-0">
      <p className="text-sm font-semibold text-secondary leading-tight truncate">{name}</p>
      <div className="flex items-center gap-1 mt-0.5">
        <StatusDot state={dotState} />
        <span className="text-2xs text-muted">{status}</span>
      </div>
    </div>
    <div className="flex items-center gap-2 flex-shrink-0">
      {!isRemote && isTauri && isEnabled && (
        <button
          onClick={isRunning ? onStop : onStart}
          className="flex items-center gap-1 px-2 py-1 text-2xs font-medium text-secondary bg-surface-raised hover:bg-surface-hover rounded-lg transition-colors duration-fast"
        >
          <Icon icon={isRunning ? Stop : Play} size="xs" weight="fill" />{isRunning ? "Stop" : "Start"}
        </button>
      )}
      {onToggle && (
        <Toggle size="sm" checked={isEnabled} onChange={() => onToggle()} aria-label={isEnabled ? "Disable" : "Enable"} />
      )}
      <IconButton variant="ghost" size="sm" aria-label={`Remove ${name}`} onClick={onRemove}>
        <Delete size="xs" />
      </IconButton>
    </div>
  </div>
);

// ─── Group container ──────────────────────────────────────────────────────────
const ManageGroup = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div>
    <p className="text-2xs font-semibold text-muted tracking-wider uppercase mb-2 px-1">{label}</p>
    <div className="rounded-2xl border border-surface-border overflow-hidden divide-y divide-surface-divider">
      {children}
    </div>
  </div>
);

// ─── ManagePanel ──────────────────────────────────────────────────────────────
export const ManagePanel = ({
  onClose, isAuthenticated, mcpLoading, isTauri,
  context7Server, context7Running,
  customServers, runningServers,
  groupedComposioConnections, composioApps, composioPolling,
  onMcpStart, onMcpStop, onMcpToggle, onMcpUninstall,
  onComposioToggle, onComposioDisconnect,
}: ManagePanelProps) => {
  const isEmpty =
    !context7Server &&
    customServers.length === 0 && groupedComposioConnections.length === 0;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.15, ease: "easeInOut" }}
      className="absolute inset-0 z-20 flex flex-col bg-surface-page"
    >
      {/* Header */}
      <div className="flex-shrink-0 px-4 sm:px-6 pt-4 pb-3 border-b border-surface-border">
        <div className="flex items-center gap-2">
          <IconButton variant="ghost" size="sm" aria-label="Back" onClick={onClose}>
            <Back size="sm" />
          </IconButton>
          <h2 className="text-sm font-semibold text-primary">Manage</h2>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto scrollbar-auto-hide px-4 sm:px-6 py-4">
        <div className="max-w-2xl mx-auto">
          {!isAuthenticated ? (
            <p className="text-xs text-muted py-8 text-center">Sign in to manage your apps.</p>
          ) : mcpLoading ? (
            <p className="text-xs text-muted py-8 text-center">Loading…</p>
          ) : isEmpty ? (
            <EmptyState
              icon={Terminal}
              title="Nothing installed"
              body="Browse apps and connect them to your AI."
              size="md"
            />
          ) : (
            <div className="space-y-5">
              {/* Knowledge */}
              {context7Server && (
                <ManageGroup label="Knowledge">
                  <ServerRow
                    icon={<Context7Icon size={14} className="text-secondary" />}
                    name="Context7"
                    dotState={context7Running ? "running" : context7Server.enabled ? "stopped" : "disabled"}
                    status={context7Running ? "Running" : context7Server.enabled ? "Stopped" : "Disabled"}
                    isTauri={isTauri} isEnabled={context7Server.enabled} isRunning={context7Running}
                    onStart={() => onMcpStart(context7Server)}
                    onStop={() => onMcpStop("context7")}
                    onToggle={() => onMcpToggle("context7", !context7Server.enabled)}
                    onRemove={() => onMcpUninstall("context7")}
                  />
                </ManageGroup>
              )}

              {/* Custom servers */}
              {customServers.length > 0 && (
                <ManageGroup label="Custom">
                  {[...customServers].sort((a, b) => a.displayName.localeCompare(b.displayName)).map(server => {
                    const isRunning = runningServers.has(server.name);
                    const isRemote  = server.type === "remote";
                    const dotState: DotState = isRemote
                      ? (server.enabled ? "running" : "disabled")
                      : isRunning ? "running" : server.enabled ? "stopped" : "disabled";
                    return (
                      <ServerRow
                        key={server.id}
                        icon={<Icon icon={Terminal} size="xs" className="text-muted" />}
                        name={server.displayName}
                        dotState={dotState}
                        status={isRemote ? (server.enabled ? "Active" : "Disabled") : isRunning ? "Running" : server.enabled ? "Stopped" : "Disabled"}
                        isTauri={isTauri} isEnabled={server.enabled} isRunning={isRunning} isRemote={isRemote}
                        onStart={() => onMcpStart(server)}
                        onStop={() => onMcpStop(server.name)}
                        onToggle={() => onMcpToggle(server.name, !server.enabled)}
                        onRemove={() => onMcpUninstall(server.name)}
                      />
                    );
                  })}
                </ManageGroup>
              )}

              {/* Composio connections */}
              {groupedComposioConnections.map(([category, conns]) => (
                <ManageGroup key={category} label={category}>
                  {conns.map(conn => {
                    const appData   = composioApps.find(a => a.appId.toLowerCase() === conn.appName.toLowerCase());
                    const isPending = conn.status !== "ACTIVE";
                    return (
                      <div key={conn.id} className="flex items-center gap-3 px-3 py-2.5 bg-surface-base">
                        <AppLogo
                          src={appData?.logo}
                          label={conn.displayName || conn.appName}
                          size="md"
                          className="bg-surface-raised border border-surface-border"
                          fallback={
                            <span className="text-xs font-bold text-muted">
                              {(conn.displayName || conn.appName).charAt(0).toUpperCase()}
                            </span>
                          }
                        />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-secondary leading-tight capitalize truncate">
                            {conn.displayName || conn.appName}
                          </p>
                          <div className="flex items-center gap-1 mt-0.5">
                            {isPending ? (
                              <span className="text-2xs text-muted">
                                {composioPolling.has(conn.appName.toLowerCase()) ? "Authorizing…" : "Pending"}
                              </span>
                            ) : (
                              <>
                                <StatusDot state={conn.enabled ? "running" : "disabled"} />
                                <span className="text-2xs text-muted">{conn.enabled ? "Active" : "Disabled"}</span>
                              </>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          {!isPending && (
                            <Toggle
                              size="sm"
                              checked={conn.enabled}
                              onChange={() => onComposioToggle(conn.id, !conn.enabled)}
                              aria-label={conn.enabled ? "Disable" : "Enable"}
                            />
                          )}
                          <IconButton
                            variant="ghost"
                            size="sm"
                            aria-label={`Disconnect ${conn.displayName || conn.appName}`}
                            onClick={() => onComposioDisconnect(conn.id, conn.appName)}
                          >
                            <Delete size="xs" />
                          </IconButton>
                        </div>
                      </div>
                    );
                  })}
                </ManageGroup>
              ))}
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
};
