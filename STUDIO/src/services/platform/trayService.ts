/**
 * System Tray Service for STUDIO
 * Manages dynamic tray menu based on application state
 */

import { invoke } from "@tauri-apps/api/core";
import { logger } from "../logging/logger";
import { isFeatureEnabled } from "./featureManager";

export class TrayService {
  /**
   * Update tray menu based on current state
   */
  static async updateMenu(isRecording: boolean, hasText: boolean): Promise<void> {
    // Only run if tray menu feature is enabled
    if (!isFeatureEnabled('trayMenu')) {
      return;
    }

    try {
      await invoke("update_tray_menu", {
        isRecording,
        hasText,
      });
      logger.debug('Tray', `Menu updated: recording=${isRecording}, hasText=${hasText}`);
    } catch (error) {
      logger.error('Tray', 'Failed to update menu', error);
    }
  }

  /**
   * Set up tray event listeners
   */
  static setupListeners(callbacks: {
    onStartRecording: () => void;
    onStopRecording: () => void;
    onCopyText: () => void;
    onNewTranscription: () => void;
  }): () => void {
    // Only run if tray menu feature is enabled
    if (!isFeatureEnabled('trayMenu')) {
      return () => {}; // Return empty cleanup function
    }

    const listeners: Array<() => void> = [];

    // Import listen function
    import("@tauri-apps/api/event").then(({ listen }) => {
      // Start recording
      listen("tray-start-recording", () => {
        logger.debug('Tray', 'Start recording event');
        callbacks.onStartRecording();
      }).then((unlisten) => {
        listeners.push(unlisten);
      }).catch((error) => {
        logger.error('Tray', 'Failed to setup start recording listener', error);
      });

      // Stop recording
      listen("tray-stop-recording", () => {
        logger.debug('Tray', 'Stop recording event');
        callbacks.onStopRecording();
      }).then((unlisten) => {
        listeners.push(unlisten);
      }).catch((error) => {
        logger.error('Tray', 'Failed to setup stop recording listener', error);
      });

      // Copy text
      listen("tray-copy-text", () => {
        logger.debug('Tray', 'Copy text event');
        callbacks.onCopyText();
      }).then((unlisten) => {
        listeners.push(unlisten);
      }).catch((error) => {
        logger.error('Tray', 'Failed to setup copy text listener', error);
      });

      // New transcription
      listen("tray-new-transcription", () => {
        logger.debug('Tray', 'New transcription event');
        callbacks.onNewTranscription();
      }).then((unlisten) => {
        listeners.push(unlisten);
      }).catch((error) => {
        logger.error('Tray', 'Failed to setup new transcription listener', error);
      });
    }).catch((error) => {
      logger.error('Tray', 'Failed to import Tauri event API', error);
    });

    // Return cleanup function
    return () => {
      listeners.forEach((unlisten) => unlisten());
    };
  }
}
