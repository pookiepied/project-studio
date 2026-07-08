/**
 * Autostart service for STUDIO
 * Manages application startup on system boot
 * Uses centralized feature manager to check if autostart is supported
 */

import { isFeatureEnabled } from "./featureManager";
import { logger } from "../logging/logger";

export class AutostartService {
  /**
   * Enable autostart
   */
  static async enable(): Promise<boolean> {
    if (!isFeatureEnabled('autostart')) {
      logger.debug('Autostart', 'Autostart not supported on this platform');
      return false;
    }

    try {
      const { enable } = await import("@tauri-apps/plugin-autostart");
      await enable();
      logger.debug('Autostart', 'Enabled');
      return true;
    } catch (error) {
      logger.error('Autostart', 'Failed to enable', error);
      return false;
    }
  }

  /**
   * Disable autostart
   */
  static async disable(): Promise<boolean> {
    if (!isFeatureEnabled('autostart')) {
      logger.debug('Autostart', 'Autostart not supported on this platform');
      return false;
    }

    try {
      const { disable } = await import("@tauri-apps/plugin-autostart");
      await disable();
      logger.debug('Autostart', 'Disabled');
      return true;
    } catch (error) {
      logger.error('Autostart', 'Failed to disable', error);
      return false;
    }
  }

  /**
   * Check if autostart is enabled
   */
  static async isEnabled(): Promise<boolean> {
    if (!isFeatureEnabled('autostart')) {
      logger.debug('Autostart', 'Autostart not supported on this platform');
      return false;
    }

    try {
      const { isEnabled } = await import("@tauri-apps/plugin-autostart");
      const enabled = await isEnabled();
      logger.debug('Autostart', 'Status:', enabled);
      return enabled;
    } catch (error) {
      logger.error('Autostart', 'Failed to check status', error);
      return false;
    }
  }

  /**
   * Toggle autostart based on setting
   */
  static async toggle(enable: boolean): Promise<boolean> {
    if (enable) {
      return await this.enable();
    } else {
      return await this.disable();
    }
  }
}
