/**
 * Conditional Features Component
 * Handles features that are only available in certain environments
 * Uses centralized feature manager for consistent behavior
 */

import { ReactNode } from 'react';
import { useFeatures } from '../hooks/useFeatures';

interface ConditionalFeaturesProps {
  children: ReactNode;
}

/**
 * Global Shortcut Handler (Tauri only)
 */
export function ConditionalGlobalShortcuts({ children }: ConditionalFeaturesProps) {
  const { isEnabled } = useFeatures();

  if (!isEnabled('globalShortcuts')) {
    return null;
  }

  return <>{children}</>;
}

/**
 * System Tray Features (Tauri only)
 */
export function ConditionalSystemTray({ children }: ConditionalFeaturesProps) {
  const { isEnabled } = useFeatures();

  if (!isEnabled('trayMenu')) {
    return null;
  }

  return <>{children}</>;
}

/**
 * Window Controls (Tauri only)
 */
export function ConditionalWindowControls({ children }: ConditionalFeaturesProps) {
  const { isEnabled } = useFeatures();

  if (!isEnabled('windowControls')) {
    return null;
  }

  return <>{children}</>;
}

/**
 * Autostart Features (Tauri only)
 */
export function ConditionalAutostart({ children }: ConditionalFeaturesProps) {
  const { isEnabled } = useFeatures();

  if (!isEnabled('autostart')) {
    return null;
  }

  return <>{children}</>;
}

/**
 * Local Model Features (Tauri only)
 */
export function ConditionalLocalModels({ children }: ConditionalFeaturesProps) {
  const { isEnabled } = useFeatures();

  if (!isEnabled('ollamaIntegration') && !isEnabled('fasterWhisper')) {
    return null;
  }

  return <>{children}</>;
}