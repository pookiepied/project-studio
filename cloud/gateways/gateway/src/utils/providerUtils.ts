import { getEnabledModalities, type ProviderModality } from "../providers/registry";

export function isProviderEnabled(providerName: string, enabledProviders: string | undefined): boolean {
  if (!enabledProviders) {
    return true;
  }

  const enabled = enabledProviders
    .split(',')
    .map(p => p.trim().toLowerCase())
    .filter(p => p.length > 0);

  return enabled.includes(providerName.toLowerCase());
}

export function isModalityEnabled(
  provider: string,
  modality: ProviderModality,
  env: { PROVIDER_MODALITIES_CONFIG?: string; ENABLED_PROVIDERS?: string },
): boolean {
  if (!isProviderEnabled(provider, env.ENABLED_PROVIDERS)) return false;
  return getEnabledModalities(provider, env.PROVIDER_MODALITIES_CONFIG).includes(modality);
}

export function isOriginAllowed(origin: string | null): boolean {
  if (!origin) return true;
  if (origin.includes('localhost') || origin.includes('127.0.0.1')) return true;
  return origin.endsWith('.pookiepied.dev') || origin === 'https://pookiepied.dev';
}