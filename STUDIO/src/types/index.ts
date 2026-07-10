// Shared types barrel — `@/types` is the import surface for truly cross-cutting
// types AND feature-domain types that are consumed by shared infra. (D-602:
// this was originally a T5.5 "back-compat shim, retire in T6.2"; T6.2 audit
// confirmed 97 consuming files — migrating them to direct `@/features/<x>/types`
// imports would create inverted-dependency smells: shared services such as
// `features/chat/conversations/chatHistoryService`, `features/chat/conversations/claude/*`,
// `services/conversations/storage/*`, `services/conversations/ownership/*`
// would reach back into `features/chat/types` for ChatConversation. The barrel
// is the PERMANENT structure, not a shim to retire. Mirror of D-422/D-524/D-527
// "shim-first" pattern where the shim turned out to be the correct final shape.)

// Token payload types (mirrored from auth service) — truly shared cross-cutting.
export interface AccessTokenPayload {
  sub: string;
  email: string;
  role: string;
  type: 'access';
  iat: number;
  exp: number;
}

export interface RefreshTokenPayload {
  sub: string;
  email?: string;
  type: 'refresh';
  iat: number;
  exp: number;
}

// API Response types — truly shared cross-cutting.
export interface APIResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  errorDetails?: any; // CategorizedError from errorService
}

// ---------------------------------------------------------------------------
// Feature-domain types — re-exported here for shared-infra consumers.
// Canonical definitions live in their feature folders (T5.5 D-527).
// Feature UI surfaces should import directly from `@/features/<x>/types`;
// shared services / cross-cutting infra should import from `@/types` here.
// ---------------------------------------------------------------------------

export type {
  HarnessEvent,
  MessageSegment,
  ChatMessage,
  ClaudeRateLimitInfo,
  ClaudeSessionMetadata,
  ConversationMetadata,
  MessageOptions,
  ChatConversation,
} from "@/features/chat/types";

export type { AppSettings, ThemePreference } from "@/features/settings/types";

export { RecordingState } from "@/features/transcription/types";
