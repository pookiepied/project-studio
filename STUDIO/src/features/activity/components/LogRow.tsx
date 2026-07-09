import { motion, AnimatePresence } from "framer-motion";
import { Expand, Collapse } from "@/ui/icons";
import { getProviderDisplayName } from "@/features/models/components/ProviderIcon";
import { getCachedProfile } from "@/core/network/userProfileCache";
import { fmtTokens, fmtCost, fmtLatency, fmtRelative } from "../formatters";
import type { LogEntry } from "../types";

// ---------------------------------------------------------------------------
// Detail field (log expand row)
// ---------------------------------------------------------------------------

const DetailField = ({ label, value }: { label: string; value: string }) => (
  <div className="min-w-0">
    <div className="text-2xs text-muted uppercase tracking-wider mb-0.5">{label}</div>
    <div className="text-xs text-secondary font-mono truncate">{value}</div>
  </div>
);

// ---------------------------------------------------------------------------
// Log row
// ---------------------------------------------------------------------------

export const LogRow = ({
  log, isExpanded, onToggle, currentUserSub, userPicture,
}: {
  log: LogEntry;
  isExpanded: boolean;
  onToggle: () => void;
  currentUserSub?: string;
  userPicture?: string;
}) => {
  const isOwn = log.user_id === currentUserSub;
  const profile = !isOwn && log.user_id ? getCachedProfile(log.user_id) : undefined;
  const initials = log.user_id ? log.user_id.slice(0, 2).toUpperCase() : "??";
  const avatarPicture = isOwn ? userPicture : profile?.picture;

  // Strict-neutral status badge (D-401): error = strong (near-black) dot,
  // timeout = faint (muted) dot. Shade carries severity, no hue.
  const statusDot = log.status === "error"
    ? <span className="absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full bg-primary ring-1 ring-surface-page" title="Error" />
    : log.status === "timeout"
    ? <span className="absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full bg-muted ring-1 ring-surface-page" title="Timeout" />
    : null;

  const displayCost = log.cost_usd != null
    ? fmtCost(log.cost_usd, 4)
    : log.estimated_cost_usd != null
    ? `~${fmtCost(log.estimated_cost_usd, 4)}`
    : "—";

  return (
    <>
      <div
        onClick={onToggle}
        className="grid items-center gap-x-2 px-3 py-2 rounded-lg cursor-pointer hover:bg-surface-hover transition-colors duration-fast"
        style={{ gridTemplateColumns: "20px minmax(0, 1fr) minmax(0, 1fr) 80px 70px 14px" }}
      >
        <div className="relative flex-shrink-0 w-5 h-5">
          {avatarPicture ? (
            <img
              src={avatarPicture}
              alt=""
              className="w-5 h-5 rounded-full object-cover"
              onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
            />
          ) : (
            <div className={`w-5 h-5 rounded-full flex items-center justify-center ${
              isOwn ? "bg-surface-active" : "bg-surface-raised border border-surface-border"
            }`}>
              <span className="text-3xs font-semibold text-muted font-mono">
                {initials}
              </span>
            </div>
          )}
          {statusDot}
        </div>
        <div className="min-w-0">
          <div className="text-xs text-muted leading-none mb-0.5">
            {fmtRelative(log.created_at)}
          </div>
          <div className="text-xs font-medium text-secondary truncate">
            {getProviderDisplayName(log.provider)}
          </div>
        </div>
        <div className="min-w-0">
          <div className="text-xs text-secondary truncate font-mono">
            {log.model.split("/").pop()}
          </div>
          <div className="flex items-center gap-1 mt-0.5">
            <span className="text-2xs text-muted">{log.request_type}</span>
            {log.source && log.source !== "direct" && (
              <span className="text-3xs px-1 py-px rounded bg-surface-active text-muted">
                {log.source}
              </span>
            )}
          </div>
        </div>
        <div className="text-right">
          <div className="text-xs text-secondary whitespace-nowrap">
            {fmtTokens(log.input_tokens)}&nbsp;<span className="text-disabled">↑</span>
          </div>
          <div className="text-xs text-secondary whitespace-nowrap">
            {fmtTokens(log.output_tokens)}&nbsp;<span className="text-disabled">↓</span>
          </div>
        </div>
        <div className="text-right">
          <div className={`text-xs whitespace-nowrap ${
            log.cost_usd != null ? "text-secondary" :
            log.estimated_cost_usd != null ? "text-muted italic" :
            "text-disabled"
          }`}>
            {displayCost}
          </div>
          <div className="text-2xs text-muted whitespace-nowrap">
            {fmtLatency(log.latency_ms)}
          </div>
        </div>
        <div className="text-muted flex-shrink-0">
          {isExpanded ? <Expand size="xs" /> : <Collapse size="xs" />}
        </div>
      </div>

      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.15, ease: [0.0, 0.0, 0.2, 1] }}
            className="overflow-hidden"
          >
            <div className="mx-3 mb-1.5 p-3 rounded-lg bg-surface-base border border-surface-border space-y-2.5">
              <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                <DetailField label="Latency" value={fmtLatency(log.latency_ms)} />
                <DetailField label="Type" value={log.request_type} />
                <DetailField label="Status" value={log.status ?? "success"} />
                {log.error_type && <DetailField label="Error Type" value={log.error_type} />}
                <DetailField label="Source" value={log.source ?? "direct"} />
                {log.tool_call_count != null && (
                  <DetailField label="Tool Calls" value={String(log.tool_call_count)} />
                )}
                <DetailField label="Cache read" value={fmtTokens(log.cache_read_tokens)} />
                <DetailField
                  label="User"
                  value={log.user_id ? `…${log.user_id.slice(-10)}` : "anonymous"}
                />
                {log.generation_id && (
                  <DetailField label="Generation ID" value={`…${log.generation_id.slice(-14)}`} />
                )}
                {log.estimated_cost_usd != null && log.cost_usd == null && (
                  <DetailField label="Est. Cost" value={`~${fmtCost(log.estimated_cost_usd, 6)}`} />
                )}
                <DetailField
                  label="Timestamp"
                  value={new Date(log.created_at).toLocaleString()}
                />
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
};
