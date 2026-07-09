import { useSyncExternalStore } from "react";
import { notificationStore, type AppNotification } from "@/core/notifications/notificationStore";

/**
 * Subscribe a component to the in-app notification store.
 * Returns the live list plus the unread count and the mutating actions.
 */
export function useNotifications(): {
  items:       AppNotification[];
  unreadCount: number;
  markAllRead: () => void;
  clear:       () => void;
} {
  const items = useSyncExternalStore(
    (cb) => notificationStore.subscribe(cb),
    () => notificationStore.getSnapshot(),
    () => notificationStore.getSnapshot(),
  );

  return {
    items,
    unreadCount: items.reduce((n, i) => (i.read ? n : n + 1), 0),
    markAllRead: () => notificationStore.markAllRead(),
    clear:       () => notificationStore.clear(),
  };
}
