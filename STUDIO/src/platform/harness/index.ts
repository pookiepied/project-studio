/**
 * The harness boundary.
 *
 * `contracts` is the hand-maintained mirror of the harness wire types and the
 * parsers that refuse anything else. `client` is the only module in STUDIO
 * that speaks HTTP. `connection` is the only module that decides where the
 * harness is. `transport` is the only module that decides how a request
 * leaves the process. Import from here, not from the files.
 */

export {
  createHarnessClient,
  type HarnessClient,
  type HarnessFailure,
  type HarnessResult,
} from './client'

export {
  readPairingState,
  resolveHarnessAddress,
  httpHarnessStatus,
  startHarness,
  harnessFailureReason,
  harnessIsStarting,
} from './connection'

export {
  attachmentDataUrl,
  harnessBytesDataUrl,
  isAttachmentReference,
  pictureMime,
} from './attachments'

export {
  createConversationClient,
  turnSettingsToWire,
  type ConversationClient,
  type ConversationDelivery,
  type ServiceInvoke,
  type SeamFailure,
  type StreamChannel,
  type TurnImageWire,
  type TurnResult,
  type TurnSettingsWire,
} from './conversation'

export {
  CAPABILITY_SLOTS,
  REASONING_LEVELS,
  executionModeFromWire,
  executionModeToWire,
  capabilityServesKind,
  connectionKinds,
  servesKindOf,
  SLOTS_BY_KIND,
  MCP_AUTH_KINDS,
  MCP_TRANSPORTS,
  type McpAuthKind,
  type McpScopeReading,
  type McpServerDraft,
  type McpServerRecord,
  type McpState,
  type McpTransport,
  type SkillListing,
  type SkillProblem,
  type SkillRecord,
  type CommandRecord,
  type CommandProblem,
  type CommandListing,
  type CommandSource,
  type CommandDetail,
  type CommandProvenance,
  type CommandKind,
  parseSandboxScopeInfo,
  parseSandboxScopeRow,
  type ApprovalAnswer,
  type CapabilitySlot,
  type CapabilityState,
  type CredentialStatus,
  type DefaultSelection,
  type ExecutionModeWire,
  type GrantDuration,
  type LanguageProtocol,
  type LibraryProvider,
  type ModelCapability,
  type ModelFacts,
  type ModelPricing,
  type ModelReferenceSlot,
  type PendingApprovalRecord,
  type PendingQuestionRecord,
  type PlanItemRecord,
  type PlanSnapshot,
  type ProbeResult,
  type ProjectRecord,
  type ProviderConnection,
  type ProviderConnectionDraft,
  type ProviderKind,
  type ProviderModel,
  type ReasoningLevel,
  type FolderListing,
  type FolderTrust,
  type SandboxLevel,
  type SandboxScopeInfo,
  type SandboxScopeRow,
  type ShellInfo,
  type ShellKind,
  type ShellOption,
  type IsolationInfo,
  type WireStreamEvent,
  type MeasuredContextUsage,
  type CompactionReadiness,
  parseCompactionReadiness,
  type BackgroundJob,
  type MediaJob,
  type MediaArtifactFile,
} from './contracts'

export {
  readChunkFacts,
  readConversationSnapshot,
  type ChunkFacts,
  type ChunkPosition,
  type ConversationMessageFacts,
  type ConversationSnapshotFacts,
  type CompactionFacts,
  type ModelRefFacts,
  type Present,
  type UsageFacts,
} from './contracts/chunks'
