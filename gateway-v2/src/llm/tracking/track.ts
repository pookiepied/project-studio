export interface TrackingSummary {
  provider: string;
  model: string;
  byokAlias: string;
  usage?: unknown;
}

export function trackUsage(_summary: TrackingSummary): void {
  return undefined;
}
