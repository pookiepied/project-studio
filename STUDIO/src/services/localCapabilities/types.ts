export type LocalCapabilityId = "claude-cli";

export interface LocalCapabilityStatus {
  id: LocalCapabilityId;
  available: boolean;
  label: string;
  version?: string;
  detail?: string;
  checkedAt: number;
}

export interface LocalCapabilitiesSnapshot {
  checkedAt: number;
  capabilities: Record<LocalCapabilityId, LocalCapabilityStatus>;
}
