/**
 * Centralized Feature Management System
 * 
 * Controls which features are available based on platform and configuration.
 * This replaces scattered environment checks throughout the codebase.
 */

import { environmentService } from './environmentService';
import { logger } from '../logging/logger';

/**
 * Detect if running on mobile device
 */
function isMobileDevice(): boolean {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') {
    return false;
  }

  // Check user agent
  const userAgent = navigator.userAgent || navigator.vendor || (window as any).opera;
  
  // Mobile device patterns
  const mobileRegex = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i;
  
  // Check touch support
  const hasTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
  
  // Check screen size (mobile typically < 768px)
  const isSmallScreen = window.innerWidth < 768;
  
  return mobileRegex.test(userAgent) || (hasTouch && isSmallScreen);
}

export interface FeatureFlags {
  // Platform-specific features
  trayMenu: boolean;
  globalShortcuts: boolean;
  autostart: boolean;
  nativeNotifications: boolean;
  
  // Local AI features
  ollamaIntegration: boolean;
  parakeet: boolean; // Local speech-to-text via Parakeet-TDT (ONNX)
  edgeTts: boolean; // Local text-to-speech via Microsoft Edge TTS
  localProviderBridge: boolean; // Daemon for local providers (Ollama, LM Studio)

  // File system features
  fileOperations: boolean;
  secureStorage: boolean;
  
  // Network features
  apiAccess: boolean;
  
  // UI features
  titleBar: boolean;
  windowControls: boolean;
  
  // Auth features
  googleOneTap: boolean;      // Desktop web only
  googleRedirect: boolean;    // Mobile web only
}

class FeatureManager {
  private features: FeatureFlags;
  private initialized = false;

  constructor() {
    this.features = this.initializeFeatures();
    this.initialized = true;
    logger.debug('FeatureManager', 'Initialized with features:', this.features);
  }

  /**
   * Initialize feature flags based on environment and capabilities
   */
  private initializeFeatures(): FeatureFlags {
    const isTauri = environmentService.isTauri();
    const isWeb = environmentService.isWeb();
    const isMobile = isMobileDevice();

    return {
      // Platform-specific features (Tauri only)
      trayMenu: isTauri,
      globalShortcuts: isTauri,
      autostart: isTauri,
      nativeNotifications: isTauri,
      titleBar: isTauri,
      windowControls: isTauri,
      
      // Local AI features (Tauri only - require file system access)
      ollamaIntegration: isTauri,
      parakeet: isTauri,
      edgeTts: isTauri,
      localProviderBridge: isTauri,

      // File system features (Tauri only)
      fileOperations: isTauri,
      secureStorage: isTauri,
      
      // Network features (Tauri only for custom API config, web uses env vars)
      apiAccess: isTauri,
      
      // Auth features (web only, platform-specific)
      googleOneTap: isWeb && !isMobile,    // Desktop web: Use One Tap popup
      googleRedirect: isWeb && isMobile,   // Mobile web: Use redirect flow
    };
  }

  /**
   * Check if a feature is enabled
   */
  isEnabled(feature: keyof FeatureFlags): boolean {
    if (!this.initialized) {
      logger.warn('FeatureManager', `Feature check before initialization: ${feature}`);
      return false;
    }
    
    return this.features[feature];
  }

  /**
   * Get all enabled features
   */
  getEnabledFeatures(): Partial<FeatureFlags> {
    const enabled: Partial<FeatureFlags> = {};
    
    for (const [key, value] of Object.entries(this.features)) {
      if (value) {
        enabled[key as keyof FeatureFlags] = value;
      }
    }
    
    return enabled;
  }

  /**
   * Get all disabled features
   */
  getDisabledFeatures(): Partial<FeatureFlags> {
    const disabled: Partial<FeatureFlags> = {};
    
    for (const [key, value] of Object.entries(this.features)) {
      if (!value) {
        disabled[key as keyof FeatureFlags] = value;
      }
    }
    
    return disabled;
  }

  /**
   * Override a feature flag (for testing or manual control)
   * Use with caution - this can break platform assumptions
   */
  override(feature: keyof FeatureFlags, enabled: boolean): void {
    logger.warn('FeatureManager', `Overriding feature ${feature}: ${this.features[feature]} -> ${enabled}`);
    this.features[feature] = enabled;
  }

  /**
   * Get current environment info
   */
  getEnvironmentInfo() {
    return {
      platform: environmentService.getEnvironment(),
      features: this.features,
      environmentInfo: environmentService.getEnvironmentInfo(),
    };
  }

  /**
   * Check if current environment supports a set of features
   */
  supportsFeatures(requiredFeatures: (keyof FeatureFlags)[]): boolean {
    return requiredFeatures.every(feature => this.isEnabled(feature));
  }

  /**
   * Get missing features from a required set
   */
  getMissingFeatures(requiredFeatures: (keyof FeatureFlags)[]): (keyof FeatureFlags)[] {
    return requiredFeatures.filter(feature => !this.isEnabled(feature));
  }
}

// Export singleton instance
export const featureManager = new FeatureManager();

// Export convenience functions
export const isFeatureEnabled = (feature: keyof FeatureFlags): boolean => {
  return featureManager.isEnabled(feature);
};

export const requiresFeatures = (features: (keyof FeatureFlags)[]): boolean => {
  return featureManager.supportsFeatures(features);
};

export const getDisabledFeatureMessage = (feature: keyof FeatureFlags): string => {
  const platform = environmentService.getEnvironment();
  
  switch (feature) {
    case 'parakeet':
      return `Local transcription is only available in the desktop version. Current platform: ${platform}`;
    case 'edgeTts':
      return `Edge TTS is only available in the desktop version. Current platform: ${platform}`;
    case 'ollamaIntegration':
      return `Ollama integration is only available in the desktop version. Current platform: ${platform}`;
    case 'globalShortcuts':
      return `Global shortcuts are only available in the desktop version. Current platform: ${platform}`;
    case 'trayMenu':
      return `System tray is only available in the desktop version. Current platform: ${platform}`;
    case 'autostart':
      return `Auto-start is only available in the desktop version. Current platform: ${platform}`;
    case 'fileOperations':
      return `File operations are only available in the desktop version. Current platform: ${platform}`;
    case 'secureStorage':
      return `Secure storage is only available in the desktop version. Current platform: ${platform}`;
    case 'googleOneTap':
      return `Google One Tap is only available on desktop web browsers. Current platform: ${platform}`;
    case 'googleRedirect':
      return `Google redirect flow is only available on mobile web browsers. Current platform: ${platform}`;
    default:
      return `Feature '${feature}' is not available on ${platform}`;
  }
};

/**
 * Check if running on mobile device
 */
export const isMobile = (): boolean => {
  return isMobileDevice();
};