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
  DEFAULT_TIMEOUT_MS,
  type HarnessAddress,
  type HarnessClient,
  type HarnessClientOptions,
  type HarnessFailure,
  type HarnessResult,
  type ModelFilter,
} from './client'

export { resolveHarnessAddress, startHarness } from './connection'

export { harnessTransport } from './transport'

export {
  createConversationClient,
  seamFailure,
  type AttachHandle,
  type AttachHandlers,
  type ChannelFactory,
  type ConversationClient,
  type ConversationClientOptions,
  type ConversationDelivery,
  type ServiceInvoke,
  type SeamFailure,
  type StreamChannel,
  type StreamSettlement,
  type SubmittedTurn,
  type TurnResult,
} from './conversation'

export {
  CAPABILITY_SLOTS,
  CAPABILITY_STATES,
  CREDENTIAL_STATUSES,
  INVOCATION_SHAPES,
  LANGUAGE_PROTOCOLS,
  MEDIA_PROTOCOLS,
  MODEL_ORIGINS,
  PROVIDER_KINDS,
  PROVIDER_SOURCES,
  RETRIEVAL_PROTOCOLS,
  parseHarnessErrorBody,
  parseModelCapability,
  parseModelPricing,
  parseProbeResult,
  parseProviderConnection,
  parseProviderConnections,
  parseProviderModel,
  parseProviderModels,
  parseWireStreamEvent,
  type CapabilitySlot,
  type CapabilityState,
  type CredentialStatus,
  type HarnessErrorBody,
  type InvocationShape,
  type LanguageConnection,
  type LanguageProtocol,
  type MediaConnection,
  type MediaProtocol,
  type ModelCapability,
  type ModelOrigin,
  type ModelPricing,
  type ProbeResult,
  type ProviderConnection,
  type ProviderConnectionDraft,
  type ProviderConnectionPatch,
  type ProviderKind,
  type ProviderModel,
  type ProviderProtocol,
  type ProviderSource,
  type RetrievalConnection,
  type RetrievalProtocol,
  type WireStreamEvent,
} from './contracts'

export {
  absent,
  present,
  readChunkFacts,
  readChunkPosition,
  readConversationMessage,
  readConversationSnapshot,
  type ChunkFacts,
  type ChunkPosition,
  type ConversationMessageFacts,
  type ConversationSnapshotFacts,
  type MessagePartFacts,
  type MessageRole,
  type ModelRefFacts,
  type Present,
  type SettlementErrorFacts,
  type SettlementFacts,
  type TurnOutcome,
  type UsageFacts,
} from './conversation-chunks'
