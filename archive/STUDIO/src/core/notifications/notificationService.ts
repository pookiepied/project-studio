import { isFeatureEnabled } from '../platform/featureManager';
import { logger } from '../logging/logger';

export class NotificationService {
  private static hasPermission = false;
  private static permissionRequested = false;
  private static useTauriNotifications = true;

  static async requestPermission(): Promise<boolean> {
    if (isFeatureEnabled('nativeNotifications')) {
      try {
        const { isPermissionGranted, requestPermission } = await import("@tauri-apps/plugin-notification");
        let permission = await isPermissionGranted();
        if (!permission) {
          permission = await requestPermission() === "granted";
        }
        this.hasPermission = permission;
        this.useTauriNotifications = true;
        logger.debug('Notifications', 'Tauri permission', permission);
        return permission;
      } catch {
        logger.warn('Notifications', 'Tauri notifications failed, falling back to browser');
        this.useTauriNotifications = false;
      }
    } else {
      this.useTauriNotifications = false;
    }

    if (!window.Notification) {
      logger.warn('Notifications', 'Not supported in this environment');
      return false;
    }

    if (Notification.permission === "granted") {
      this.hasPermission = true;
      return true;
    }

    if (Notification.permission === "denied") {
      logger.warn('Notifications', 'Permission denied by user');
      return false;
    }

    if (Notification.permission === "default" && !this.permissionRequested) {
      this.permissionRequested = true;
      const permission = await Notification.requestPermission();
      this.hasPermission = permission === "granted";
      if (!this.hasPermission) logger.warn('Notifications', 'Permission not granted');
      return this.hasPermission;
    }

    return false;
  }

  static async showNative(title: string, body: string, options?: NotificationOptions) {
    if (!this.hasPermission) {
      logger.debug('Notifications', 'Skipping notification (no permission)');
      return;
    }

    if (this.useTauriNotifications && isFeatureEnabled('nativeNotifications')) {
      try {
        const { sendNotification } = await import("@tauri-apps/plugin-notification");
        await sendNotification({ title, body, icon: options?.icon });
        logger.debug('Notifications', `Tauri notification shown: ${title} - ${body}`);
        return;
      } catch (error) {
        logger.error('Notifications', 'Tauri notification failed', error);
        this.useTauriNotifications = false;
      }
    }

    if (window.Notification) {
      try {
        new Notification(title, {
          body,
          icon: options?.icon || "/icon.png",
          tag: options?.tag || "studio",
          silent: options?.silent ?? false,
          ...options,
        });
        logger.debug('Notifications', `Browser notification shown: ${title} - ${body}`);
      } catch (error) {
        logger.error('Notifications', 'Failed to show notification', error);
      }
    }
  }

  static showRecordingStarted() {
    this.showNative("STUDIO", "Recording started", { tag: "recording-state", silent: false });
  }

  static showTranscriptionComplete(rephrased: boolean) {
    this.showNative("STUDIO", rephrased ? "Text transcribed and rephrased!" : "Text transcribed!", {
      tag: "transcription-complete",
      silent: false,
    });
  }

  static showConversationDone(conversationTitle: string) {
    this.showNative("STUDIO", `"${conversationTitle}" finished responding`, {
      tag: `conversation-done-${Date.now()}`,
      silent: false,
    });
  }

  static showPermissionNeeded(conversationTitle: string) {
    this.showNative(
      "STUDIO - Permission Required",
      `"${conversationTitle}" is waiting for your approval. Click to view.`,
      { tag: `permission-${Date.now()}`, silent: false }
    );
  }

  static isSupported(): boolean {
    return typeof window !== "undefined" && "Notification" in window;
  }

  static getPermissionStatus(): NotificationPermission | "unsupported" {
    if (!this.isSupported()) return "unsupported";
    return Notification.permission;
  }
}
