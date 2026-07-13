import { useEffect, useMemo, useRef } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Redo,
  Clock,
  UserCircle,
  Error,
} from "@/ui/icons";
import type { ClaudeAccountStatus } from "@/cliBridges";
import type { ClaudeRateLimitInfo } from "@/types";
import { Button } from "@/ui/primitives/Button";
import { IconButton } from "@/ui/primitives/IconButton";
import { useDisclosure } from "@/lib/hooks/useDisclosure";

interface ClaudeUsageBadgeProps {
  status: ClaudeAccountStatus | null;
  loading: boolean;
  rateLimit: ClaudeRateLimitInfo | undefined;
  onRefresh: () => void | Promise<unknown>;
  compact?: boolean;
}

function capitalize(value: string | undefined): string | null {
  if (!value) return null;
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function toPercent(value: number | undefined): number | null {
  if (typeof value !== "number" || Number.isNaN(value)) return null;
  return Math.max(0, Math.min(100, value <= 1 ? value * 100 : value));
}

function normalizeTimestamp(value: number | undefined): number | null {
  if (typeof value !== "number" || Number.isNaN(value) || value <= 0) return null;
  return value > 1e12 ? value : value * 1000;
}

function formatUpdatedAt(checkedAt: number | undefined): string | null {
  if (!checkedAt) return null;
  const seconds = Math.max(0, Math.round((Date.now() - checkedAt) / 1000));
  if (seconds < 10) return "Updated just now";
  if (seconds < 60) return `Updated ${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `Updated ${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  return `Updated ${hours}h ago`;
}

function formatRateLimitType(rateLimitType: string | undefined): string {
  switch (rateLimitType) {
    case "five_hour":
      return "5-hour window";
    case "seven_day":
      return "Weekly window";
    default:
      return "Usage window";
  }
}

function formatStatus(status: string | undefined): string | null {
  if (!status) return null;
  switch (status) {
    case "allowed_warning":
      return "Usage warning";
    case "blocked":
      return "Usage blocked";
    case "allowed":
      return "Within limits";
    default:
      return status.replace(/[_-]+/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
  }
}

function getThresholdValue(surpassedThreshold: boolean | number | undefined): number | null {
  if (typeof surpassedThreshold === "number" && !Number.isNaN(surpassedThreshold)) {
    return surpassedThreshold <= 1 ? surpassedThreshold * 100 : surpassedThreshold;
  }
  return null;
}

export function ClaudeUsageBadge({
  status,
  loading,
  rateLimit,
  onRefresh,
  compact = false,
}: ClaudeUsageBadgeProps) {
  const { open, onClose, onToggle } = useDisclosure();
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handleClick = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        onClose();
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [onClose, open]);

  const subscriptionLabel = capitalize(status?.subscriptionType) ?? "Claude";
  const utilizationPct = toPercent(rateLimit?.utilization);
  const resetsAt = normalizeTimestamp(rateLimit?.resetsAt);
  const updatedAtLabel = formatUpdatedAt(status?.checkedAt);
  const rateLimitLabel = formatRateLimitType(rateLimit?.rateLimitType);
  const rateLimitStatus = formatStatus(rateLimit?.status);
  const thresholdPct = getThresholdValue(rateLimit?.surpassedThreshold);

  const summary = useMemo(() => {
    if (loading && !status) return "Claude";
    if (!status?.available) return "Claude";
    if (!status.loggedIn) return "Sign in";
    return subscriptionLabel;
  }, [loading, status, subscriptionLabel]);

  const healthTone = !status?.available || !status?.loggedIn
    ? "warning"
    : rateLimit?.isUsingOverage || rateLimit?.surpassedThreshold === true || (thresholdPct != null && utilizationPct != null && utilizationPct >= thresholdPct)
    ? "warning"
    : "normal";

  return (
    <div className="relative flex-shrink-0" ref={containerRef}>
      <Button
        variant="ghost"
        onClick={onToggle}
        className={`gap-1.5 rounded-md ${
          compact ? "h-8 w-8 px-0" : "h-7 px-2"
        } ${
          healthTone === "warning"
            ? "text-secondary dark:text-secondary hover:bg-surface-raised dark:hover:bg-surface-raised/30"
            : "text-muted dark:text-disabled hover:bg-surface-base dark:hover:bg-surface-raised"
        }`}
        title="Claude usage and subscription status"
      >
        {healthTone === "warning" ? (
          <Error size={compact ? "md" : "xs"} weight="fill" />
        ) : (
          <UserCircle size={compact ? "md" : "xs"} />
        )}
        {!compact && (
          <span className="text-xs font-medium leading-none max-w-[110px] truncate">
            {summary}
          </span>
        )}
      </Button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 6 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 6 }}
            transition={{ duration: 0.14, ease: "easeOut" }}
            className="absolute right-0 top-full mt-1.5 w-[280px] z-50 rounded-xl border border-surface-border dark:border-surface-border bg-surface-page dark:bg-surface-base shadow-xl overflow-hidden"
          >
            <div className="px-3 py-2.5 border-b border-surface-border dark:border-surface-border flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-medium text-primary dark:text-primary truncate">
                  Claude account
                </p>
                <p className="text-2xs text-disabled dark:text-muted truncate">
                  {status?.email ?? status?.detail ?? "Bridge status"}
                </p>
              </div>
              <IconButton
                onClick={() => void onRefresh()}
                aria-label="Refresh Claude status"
                title="Refresh Claude status"
                className="h-7 w-7 rounded-md text-disabled dark:text-muted hover:bg-surface-base dark:hover:bg-surface-raised hover:text-secondary dark:hover:text-disabled"
              >
                <Redo size="sm" className={loading ? "animate-spin" : ""} />
              </IconButton>
            </div>

            <div className="p-3 space-y-2.5">
              <div className="flex items-center justify-between gap-3 text-xs">
                <span className="text-muted dark:text-disabled">Plan</span>
                <span className="font-medium text-primary dark:text-primary">
                  {subscriptionLabel}
                </span>
              </div>

              <div className="flex items-center justify-between gap-3 text-xs">
                <span className="text-muted dark:text-disabled">Auth</span>
                <span className="font-medium text-primary dark:text-primary">
                  {status?.loggedIn ? capitalize(status.authMethod) ?? "Connected" : "Signed out"}
                </span>
              </div>

              <div className="flex items-center justify-between gap-3 text-xs">
                <span className="text-muted dark:text-disabled">{rateLimitLabel}</span>
                <span className="font-medium text-primary dark:text-primary">
                  {utilizationPct != null ? `${Math.round(utilizationPct)}% used` : "Waiting for live usage"}
                </span>
              </div>

              {resetsAt && (
                <div className="flex items-center justify-between gap-3 text-xs">
                  <span className="text-muted dark:text-disabled">Resets</span>
                  <span className="font-medium text-primary dark:text-primary">
                    {new Date(resetsAt).toLocaleString([], {
                      month: "short",
                      day: "numeric",
                      hour: "numeric",
                      minute: "2-digit",
                    })}
                  </span>
                </div>
              )}

              {(rateLimit?.isUsingOverage || rateLimit?.surpassedThreshold || rateLimit?.status) && (
                <div className="rounded-lg bg-surface-page dark:bg-surface-raised px-2.5 py-2 text-2xs text-muted dark:text-disabled">
                  {rateLimitStatus ?? "Claude reported elevated usage for this subscription window."}
                  {rateLimit?.isUsingOverage ? " Overage is active." : ""}
                  {thresholdPct != null ? ` Warning threshold: ${Math.round(thresholdPct)}%.` : ""}
                </div>
              )}

              {updatedAtLabel && (
                <div className="flex items-center gap-1.5 text-2xs text-disabled dark:text-muted pt-0.5">
                  <Clock size="xs" />
                  <span>{updatedAtLabel}</span>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
