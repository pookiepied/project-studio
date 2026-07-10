/**
 * ConnectionStatusBar — Surfaces connection warnings inline above the chat input.
 *
 * Shows nothing when everything is healthy. Appears only when:
 *   - WebSocket is reconnecting or failed (mid-turn)
 *   - One or more MCP servers have crashed or failed to restart
 *
 * The Retry button delegates to connectionManager.retry(convId), which calls
 * back into wsPool without the UI needing to know about wsPool at all.
 *
 * Usage:
 *   <ConnectionStatusBar convId={activeConvId} />
 */

import { motion, AnimatePresence } from "framer-motion";
import { useConnectionManager } from "@/app/hooks/useConnectionManager";

interface Props {
  convId?: string;
}

const RECONNECT_ICON = (
  <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
  </svg>
);

const WARN_ICON = (
  <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
  </svg>
);

export function ConnectionStatusBar({ convId }: Props) {
  const { wsStatus, canRetry, retry, mcpServers, conversationState } = useConnectionManager(convId);

  const crashedServers = mcpServers.filter(s => s.status === "crashed" || s.status === "restarting");
  const isWsReconnecting = wsStatus === "reconnecting";
  const isWsFailed = wsStatus === "failed";

  const showBar = isWsReconnecting || isWsFailed || crashedServers.length > 0;

  return (
    <AnimatePresence>
      {showBar && (
        <motion.div
          initial={{ opacity: 0, y: 6, height: 0 }}
          animate={{ opacity: 1, y: 0, height: "auto" }}
          exit={{ opacity: 0, y: 6, height: 0 }}
          transition={{ duration: 0.2 }}
          className="overflow-hidden"
        >
          <div className="mb-2 rounded-lg border border-surface-border bg-surface-raised px-3 py-2 text-sm flex flex-col gap-1.5">

            {/* WebSocket status row */}
            {(isWsReconnecting || isWsFailed) && (
              <div className="flex items-center gap-2">
                <span className={isWsReconnecting ? "text-secondary" : "text-secondary"}>
                  {isWsReconnecting ? RECONNECT_ICON : WARN_ICON}
                </span>
                <span className="text-gray-300 flex-1">
                  {isWsReconnecting
                    ? `Reconnecting… (attempt ${conversationState?.reconnectAttempt ?? 1})`
                    : conversationState?.lastError ?? "Connection lost"}
                </span>
                {isWsFailed && canRetry && (
                  <button
                    onClick={retry}
                    className="text-xs font-medium text-secondary hover:text-secondary transition-colors shrink-0"
                  >
                    Retry
                  </button>
                )}
              </div>
            )}

            {/* MCP server rows */}
            {crashedServers.map(srv => (
              <div key={srv.name} className="flex items-center gap-2">
                <span className={srv.status === "restarting" ? "text-secondary" : "text-secondary"}>
                  {srv.status === "restarting" ? RECONNECT_ICON : WARN_ICON}
                </span>
                <span className="text-gray-300 flex-1">
                  {srv.status === "restarting"
                    ? `Restarting ${srv.name}…`
                    : `${srv.name} crashed`}
                </span>
                {srv.restartCount > 0 && (
                  <span className="text-xs text-gray-500">
                    {srv.restartCount}× restarted
                  </span>
                )}
              </div>
            ))}

          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
