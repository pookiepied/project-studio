export const RETIRED_PROVIDER_IDS = ["github-copilot"] as const;

export function isRetiredProvider(id: string): boolean {
  return RETIRED_PROVIDER_IDS.some((retired) => retired === id.toLowerCase());
}
