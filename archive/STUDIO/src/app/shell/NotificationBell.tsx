/**
 * NotificationBell — the account-based notification control.
 *
 * A bell button with an unread badge that opens a dropdown list of agent
 * notifications (running / done / failed / cancelled). Self-contained and
 * shell-agnostic: the workspace shell mounts it in the FloatingPanel dock, the
 * standard shell mounts it in the TitleBar. Single source of truth for the
 * notification UI so the two shells never drift.
 */

import { useEffect, useRef } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Bell, type IconSize } from "@/ui/icons";
import { Button } from "@/ui/primitives/Button";
import { IconButton } from "@/ui/primitives/IconButton";
import { useNotifications } from "@/app/hooks/useNotifications";
import {
  broadcastPanelOpen,
  useExclusivePanel,
} from "@/lib/hooks/useExclusivePanel";
import { useDisclosure } from "@/lib/hooks/useDisclosure";
import type {
  AppNotification,
  AgentNotificationStatus,
} from "@/core/notifications/notificationStore";

function relativeTime(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

const STATUS_DOT: Record<AgentNotificationStatus, string> = {
  running: "bg-surface-raised",
  done: "bg-surface-raised",
  failed: "bg-surface-raised",
  cancelled: "bg-primary",
};

function NotificationRow({ n }: { n: AppNotification }) {
  return (
    <div
      className={`flex gap-2.5 px-4 py-2.5 ${n.read ? "" : "bg-surface-hover"}`}
    >
      <span
        className={`mt-1.5 h-2 w-2 flex-shrink-0 rounded-full ${STATUS_DOT[n.status]}`}
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <p className="truncate text-sm font-medium text-primary">
            {n.title}
          </p>
          <span className="flex-shrink-0 text-2xs text-muted">
            {relativeTime(n.timestamp)}
          </span>
        </div>
        <p className="mt-0.5 line-clamp-2 text-xs leading-relaxed text-secondary">
          {n.body}
        </p>
      </div>
    </div>
  );
}

function NotificationPanel({
  onClose,
  anchorRef,
  align,
}: {
  onClose: () => void;
  anchorRef: React.RefObject<HTMLDivElement | null>;
  align: "left" | "right";
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const { items, clear } = useNotifications();

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (
        panelRef.current?.contains(target) ||
        anchorRef.current?.contains(target)
      ) {
        return;
      }
      onClose();
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [onClose, anchorRef]);

  return (
    <motion.div
      ref={panelRef}
      initial={{ opacity: 0, y: -6, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -6, scale: 0.97 }}
      transition={{ duration: 0.14, ease: "easeOut" }}
      className={`absolute top-full z-50 mt-2 w-80 overflow-hidden rounded-xl border border-surface-border bg-surface-page shadow-xl dark:bg-surface-raised ${
        align === "right" ? "right-0" : "left-0"
      }`}
    >
      <div className="flex items-center justify-between border-b border-surface-border px-4 py-3">
        <h3 className="text-sm font-semibold text-primary">Notifications</h3>
        {items.length > 0 && (
          <Button
            onClick={clear}
            variant="ghost"
            className="h-auto gap-2 px-0 py-0 text-xs text-muted"
          >
            Clear
          </Button>
        )}
      </div>

      {items.length === 0 ? (
        <div className="flex flex-col items-center justify-center px-4 py-10 text-center">
          <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-surface-hover">
            <Bell size="lg" className="text-muted" />
          </div>
          <p className="mb-1 text-sm font-semibold text-secondary">
            You're all caught up!
          </p>
          <p className="text-xs leading-relaxed text-muted">
            We'll notify you when there's
            <br />
            something new.
          </p>
        </div>
      ) : (
        <div className="max-h-96 divide-y divide-surface-divider overflow-y-auto">
          {items.map((n) => (
            <NotificationRow key={n.id} n={n} />
          ))}
        </div>
      )}
    </motion.div>
  );
}

/**
 * @param align  which edge the dropdown aligns to (default "right")
 * @param size   bell icon size keyword (default "sm")
 */
export function NotificationBell({
  align = "right",
  size = "sm",
}: {
  align?: "left" | "right";
  size?: IconSize;
}) {
  const { open, setOpen, onClose } = useDisclosure();
  const wrapperRef = useRef<HTMLDivElement>(null);
  const { unreadCount, markAllRead } = useNotifications();

  useExclusivePanel("notifications", open, onClose);

  return (
    <div className="relative" ref={wrapperRef}>
      <IconButton
        onClick={() =>
          setOpen((value) => {
            const next = !value;
            if (next) {
              broadcastPanelOpen("notifications");
              markAllRead();
            }
            return next;
          })
        }
        className="group relative rounded-full"
        aria-label={
          unreadCount > 0
            ? `Notifications (${unreadCount} unread)`
            : "Notifications"
        }
      >
        <Bell
          size={size}
          weight="regular"
          className="text-muted transition-colors group-hover:text-primary"
        />
        {unreadCount > 0 && (
          <span className="absolute right-0.5 top-0.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-surface-raised px-1 text-3xs font-semibold leading-none text-on-emphasis">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </IconButton>

      <AnimatePresence>
        {open && (
          <NotificationPanel
            onClose={onClose}
            anchorRef={wrapperRef}
            align={align}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
