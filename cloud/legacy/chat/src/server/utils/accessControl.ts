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

export function isOriginAllowed(origin: string | null): boolean {
  if (!origin) return true;
  // Local development
  if (origin.includes('localhost') || origin.includes('127.0.0.1')) return true;
  // Production domains
  return origin.endsWith('.pookiepied.dev') || origin === 'https://pookiepied.dev';
}