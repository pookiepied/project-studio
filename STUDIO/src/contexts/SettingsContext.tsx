/**
 * Settings Context
 * 
 * Provides a single source of truth for application settings.
 * Loads settings once on app initialization and provides them to all components.
 * Eliminates duplicate loads and potential race conditions.
 */

import { createContext, useContext, ReactNode, useState, useEffect, useCallback } from "react";
import { AppSettings } from "../types";
import { configService } from "../services/storage/configService";
import { logger } from "../services/logging/logger";
import { isThemePreference } from "../utils/theme";

interface SettingsContextType {
  settings: AppSettings;
  isLoading: boolean;
  updateSettings: (updates: Partial<AppSettings>) => Promise<void>;
  reloadSettings: () => Promise<void>;
}

const SettingsContext = createContext<SettingsContextType | null>(null);

interface SettingsProviderProps {
  children: ReactNode;
}

export const SettingsProvider = ({ children }: SettingsProviderProps) => {
  const [settings, setSettings] = useState<AppSettings>(() => {
    const defaults = configService.loadSync();
    // Read theme from localStorage synchronously so the initial React state
    // already matches what the early-init script set on <html>. This prevents
    // MainLayout's useEffect from immediately removing the dark class before
    // the async load completes.
    try {
      const stored = localStorage.getItem("studio-theme");
      if (isThemePreference(stored)) {
        return { ...defaults, theme: stored };
      }
    } catch {
      /* ignore storage failures */
    }
    return defaults;
  });
  const [isLoading, setIsLoading] = useState(true);

  // Load settings from storage on mount
  useEffect(() => {
    const loadSettings = async () => {
      try {
        const loaded = await configService.load();
        setSettings(loaded);
      } catch (error) {
        logger.error('Settings', 'Failed to load settings', error);
      } finally {
        setIsLoading(false);
      }
    };

    loadSettings();
  }, []);

  // Update settings and persist
  const updateSettings = useCallback(async (updates: Partial<AppSettings>) => {
    try {
      logger.debug('SettingsContext', 'Updating settings', updates);
      setSettings(prev => ({ ...prev, ...updates }));
      await configService.save(updates);
      const updated = await configService.load();
      logger.debug('SettingsContext', 'Settings updated successfully');
      setSettings(updated);
    } catch (error) {
      logger.error('SettingsContext', 'Failed to update settings', error);
      throw error;
    }
  }, []);

  // Reload settings from storage
  const reloadSettings = useCallback(async () => {
    try {
      setIsLoading(true);
      const loaded = await configService.load();
      setSettings(loaded);
    } catch (error) {
      logger.error('Settings', 'Failed to reload settings', error);
      throw error;
    } finally {
      setIsLoading(false);
    }
  }, []);

  return (
    <SettingsContext.Provider
      value={{
        settings,
        isLoading,
        updateSettings,
        reloadSettings,
      }}
    >
      {children}
    </SettingsContext.Provider>
  );
};

export const useSettings = (): SettingsContextType => {
  const context = useContext(SettingsContext);
  if (!context) {
    throw new Error("useSettings must be used within SettingsProvider");
  }
  return context;
};
