import { useEffect } from "react";
import { memorySystem } from "@/core/storage/memorySystem";
import { NotificationService } from "@/core/notifications";
import { backgroundSessionTracker } from "@/features/chat/conversations/backgroundSessionTracker";

interface UseChatBackgroundServicesOptions {
  showNotifications: boolean;
  notifyConversationDone: boolean;
}

export function useChatBackgroundServices({
  showNotifications,
  notifyConversationDone,
}: UseChatBackgroundServicesOptions) {
  useEffect(() => {
    memorySystem.initialize().catch(() => {});
  }, []);

  useEffect(() => {
    if (!showNotifications || !notifyConversationDone) {
      backgroundSessionTracker.setCompletionCallback(() => {});
      return;
    }

    NotificationService.requestPermission().catch(() => {});
    backgroundSessionTracker.setCompletionCallback((_convId, title) => {
      NotificationService.showConversationDone(title);
    });
    backgroundSessionTracker.setPermissionCallback((_convId, title) => {
      NotificationService.showPermissionNeeded(title);
    });
  }, [showNotifications, notifyConversationDone]);
}
