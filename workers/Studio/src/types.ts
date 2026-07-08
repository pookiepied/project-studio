/// <reference types="@cloudflare/workers-types" />

export interface Env {
  STUDIO_DB: D1Database;
  ENVIRONMENT?: string;
}

// ── Preference shapes ─────────────────────────────────────────────────────────

export interface ModelPreferences {
  defaultChatModel?:    string;
  transcriptionModel?:  string;
  rephraseModel?:       string;
  ttsModel?:            string;
  imageModel?:          string;
  videoModel?:          string;
  [key: string]: unknown;
}

export interface UIPreferences {
  theme?:             string;
  language?:          string;
  showNotifications?: boolean;
  [key: string]: unknown;
}

export interface BehaviorPreferences {
  autoRephrase?:   boolean;
  rephraseTone?:   string;
  autopilotMode?:  boolean;
  [key: string]: unknown;
}

export interface UserPreferences {
  user_id:    string;
  models:     ModelPreferences;
  ui:         UIPreferences;
  behavior:   BehaviorPreferences;
  updated_at: number;
}

export interface PutPreferencesBody {
  models?:   Partial<ModelPreferences>;
  ui?:       Partial<UIPreferences>;
  behavior?: Partial<BehaviorPreferences>;
}
