/**
 * The harness wire contract, mirrored by hand.
 *
 * Source of truth: `STUDIO HARNESS/src/contracts/providers.ts` and
 * `STUDIO HARNESS/src/contracts/models.ts`. Over there the shapes are valibot
 * schemas and the types are inferred from them; over here they are written
 * out, because STUDIO has no schema library and adding one to a desktop
 * bundle to re-describe eleven objects is not a trade worth making. That makes
 * this file a hand-maintained mirror: when the harness contract changes, this
 * file does not notice, and nothing in either build will tell you. Update it
 * in the same change, or the parsers below will start rejecting responses that
 * are perfectly valid — which is the failure mode this design chooses, since
 * a rejection is visible and a silent misread is not.
 *
 * These are WIRE types. They are not view types. `src/domain/models/types.ts`
 * keeps its own `Provider` and `Model` for the offline catalog, and the two
 * deliberately disagree — `Provider` is `{id, name, compatibility, custom}`,
 * a `ProviderConnection` is a different thing with a different lifecycle.
 * Do not merge them and do not import this file into `domain/`. Mapping
 * happens once, at the UI boundary, in whichever component renders both.
 * (Audit finding FE-05.)
 *
 * The rule the whole design rests on: a `ProviderConnection` NEVER carries an
 * API key, in either direction. It carries a `CredentialStatus` and nothing
 * more. A key travels only in the body of a create or update request, where
 * the harness strips it into the OS credential store before the record exists
 * (`STUDIO HARNESS/src/transport/http/routes/providers.ts:36-60`). Every
 * parser below therefore builds a fresh object out of named fields rather than
 * narrowing the response in place, so a response body that carries an `apiKey`
 * cannot smuggle it into a parsed value.
 *
 * Every parser returns `null` rather than throwing. A response that does not
 * match the contract is a failure the client turns into an error case, not an
 * exception the UI has to catch.
 */


export {
  type ProviderKind,
  type LanguageProtocol,
  type CredentialStatus,
  type CapabilityState,
  REASONING_LEVELS,
  type ReasoningLevel,
  type ExecutionModeWire,
  executionModeToWire,
  executionModeFromWire,
  CAPABILITY_SLOTS,
  type CapabilitySlot,
  type ConnectionServes,
  SLOTS_BY_KIND,
  servesKindOf,
  capabilityServesKind,
  connectionKinds,
} from './picklists'

export {
  type ProviderConnection,
  type ProviderConnectionDraft,
  type ProviderConnectionPatch,
  type ProbeResult,
  parseProviderConnection,
  parseProviderConnections,
  parseProbeResult,
} from './connections'

export {
  type ModelCapability,
  type ModelPricing,
  type ProviderModel,
  type LibraryProvider,
  parseModelCapability,
  parseProviderModel,
  parseProviderModels,
  parseLibraryProviders,
  type ProviderIcon,
  parseProviderIcon,
} from './models'

export {
  type ModelReferenceSlot,
  type DefaultSelection,
  parseProviderDefaults,
} from './defaults'

export {
  type HarnessErrorBody,
  parseHarnessErrorBody,
} from './errors'

export {
  type ConversationRecord,
  parseConversationRecord,
  parseConversationRecords,
  type ConversationCreateDraft,
  type ConversationPatch,
  type PurgeOutcome,
  parsePurgeOutcome,
  type OrphanTrees,
  parseOrphanTrees,
  type OrphanSweepOutcome,
  parseOrphanSweepOutcome,
} from './conversations'

export {
  type ProjectRecord,
  parseProjectRecord,
  parseProjectRecords,
  type ProjectFolderSpec,
  type ProjectCreateDraft,
  type ProjectPatch,
} from './projects'

export {
  type GrantDuration,
  type ApprovalAnswer,
  type PendingApprovalRecord,
  parsePendingApprovals,
} from './approvals'

export {
  type PendingQuestionRecord,
  parsePendingQuestions,
} from './questions'

export {
  type PlanItemRecord,
  type PlanSnapshot,
  parsePlanSnapshot,
} from './plans'

export {
  type WireStreamEvent,
  parseWireStreamEvent,
} from './stream'

export {
  MCP_TRANSPORTS,
  type McpTransport,
  MCP_AUTH_KINDS,
  type McpAuthKind,
  type McpState,
  type McpScopeReading,
  type McpServerRecord,
  parseMcpServer,
  parseMcpServers,
  type McpServerDraft,
} from './mcp'

export {
  type SkillRecord,
  type SkillProblem,
  type SkillListing,
  parseSkill,
  parseSkillListing,
} from './skills'

export {
  type SandboxLevel,
  type SandboxScopeMode,
  type SandboxScopeSource,
  type SandboxScopeRow,
  type FolderTrust,
  type SandboxScopeInfo,
  type DetectedPreset,
  parseSandboxScopeRow,
  parseFolderTrust,
  parseSandboxScopeInfo,
  parseDetectedPresets,
  type FolderListing,
  parseFolderListing,
} from './sandbox'

export {
  type MeasuredContextUsage,
  parseMeasuredContextUsage,
} from './context'

export {
  type BackgroundJob,
  type MediaJob,
  type MediaArtifactFile,
  parseMediaJobs,
  parseMediaArtifactFiles,
  parseBackgroundJobs,
  parseBackgroundJob,
} from './jobs'

export {
  readChunkFacts,
  readConversationSnapshot,
  type ChunkFacts,
  type ConversationSnapshotFacts,
} from './chunks'
