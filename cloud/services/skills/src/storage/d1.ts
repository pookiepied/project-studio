import type { SkillRuntime, SkillScope, SkillSourceType } from "../features/types";

/** Raw D1 row from the skill_registrations table. */
export interface SkillRegistrationRow {
  id: string;
  user_id: string;
  device_id: string | null;
  scope: SkillScope;
  key: string;
  name: string;
  description: string;
  category: string | null;
  version: string | null;
  allowed_runtime: SkillRuntime;
  source_type: SkillSourceType;
  source_url: string | null;
  local_path: string | null;
  manifest_json: string;
  content_hash: string | null;
  enabled: number;
  last_seen_at: number | null;
  created_at: number;
  updated_at: number;
}

/** Payload accepted by register-local / skill_register_local. */
export interface RegisterLocalInput {
  userId: string;
  deviceId?: string | null;
  key: string;
  name: string;
  description: string;
  category?: string | null;
  version?: string | null;
  scope?: SkillScope;
  allowedRuntime?: SkillRuntime;
  sourceType?: SkillSourceType;
  sourceUrl?: string | null;
  localPath?: string | null;
  manifestJson?: string;
  contentHash?: string | null;
  enabled?: boolean;
}

/** Normalized audit entry. */
export interface AuditEntry {
  userId?: string;
  deviceId?: string | null;
  skillKey?: string;
  action: string;
  metadata?: Record<string, unknown>;
}
