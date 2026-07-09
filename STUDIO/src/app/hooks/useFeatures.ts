/**
 * React Hook for Feature Management
 * 
 * Provides React components with easy access to feature flags
 */

import { useMemo } from 'react';
import { featureManager, isFeatureEnabled, type FeatureFlags } from '@/core/platform/featureManager';

export interface UseFeatureResult {
  isEnabled: (feature: keyof FeatureFlags) => boolean;
  features: FeatureFlags;
  enabledFeatures: Partial<FeatureFlags>;
  disabledFeatures: Partial<FeatureFlags>;
  platform: 'tauri' | 'web';
  supportsFeatures: (features: (keyof FeatureFlags)[]) => boolean;
  getMissingFeatures: (features: (keyof FeatureFlags)[]) => (keyof FeatureFlags)[];
}

/**
 * Hook to access feature flags in React components
 */
export function useFeatures(): UseFeatureResult {
  const result = useMemo(() => {
    const envInfo = featureManager.getEnvironmentInfo();
    
    return {
      isEnabled: isFeatureEnabled,
      features: envInfo.features,
      enabledFeatures: featureManager.getEnabledFeatures(),
      disabledFeatures: featureManager.getDisabledFeatures(),
      platform: envInfo.platform,
      supportsFeatures: (features: (keyof FeatureFlags)[]) => featureManager.supportsFeatures(features),
      getMissingFeatures: (features: (keyof FeatureFlags)[]) => featureManager.getMissingFeatures(features),
    };
  }, []); // Empty dependency array since features don't change at runtime
  
  return result;
}

/**
 * Hook to check if a specific feature is enabled
 */
export function useFeature(feature: keyof FeatureFlags): boolean {
  return useMemo(() => isFeatureEnabled(feature), [feature]);
}

/**
 * Hook to check if multiple features are supported
 */
export function useRequiredFeatures(features: (keyof FeatureFlags)[]): {
  supported: boolean;
  missing: (keyof FeatureFlags)[];
} {
  return useMemo(() => ({
    supported: featureManager.supportsFeatures(features),
    missing: featureManager.getMissingFeatures(features),
  }), [features]);
}