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
