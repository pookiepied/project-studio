import { catalogFrom } from '@/domain/models/catalog'
import type { ReasoningChoice } from '@/domain/models/types'
import type { Conversation } from '@/domain/conversation/types'
import type { Project } from '@/domain/projects/types'
import {
  executionModeFromWire,
  type DefaultSelection,
  type ExecutionModeWire,
  type HarnessResult,
  type ProviderConnection,
  type ProviderModel,
} from '@/platform/harness'
import type { ModelCatalogState } from '@/stores/workspace/types'

/**
 * The wire's rows become the workspace's, here, once.
 *
 * Everything in this file is a plain function of what the harness answered:
 * no state, no client, no clock. It is the one place a wire vocabulary is
 * translated into the domain's, so a reader of the store never meets a
 * `permissionMode: 'auto'` or a `reasoningLevel: 'default'` that the rest of
 * the app has no word for.
 */

/** Exactly the fields this module maps, so no wire type leaks into context. */
export interface ConversationRecordLike {
  readonly id: string
  readonly title: string | null
  readonly projectId: string | null
  readonly pinned: boolean
  readonly archived: boolean
  readonly lastTurnAt: number
  readonly modelId: string | null
  readonly reasoningLevel: string | null
  readonly permissionMode: ExecutionModeWire
}

function isReasoningLevel(value: string | null): value is ReasoningChoice {
  return (
    value === 'minimal' ||
    value === 'low' ||
    value === 'medium' ||
    value === 'high' ||
    value === 'xhigh' ||
    value === 'max'
  )
}

export function mapRecord(record: ConversationRecordLike): Conversation {
  return {
    id: record.id,
    title: record.title,
    projectId: record.projectId,
    updatedAt: record.lastTurnAt,
    pinned: record.pinned,
    archived: record.archived,
    modelId: record.modelId,
    // Rows written before the dial lost its Default step still carry
    // "default"; they read as absent and the harness rests them on medium.
    reasoningLevel: isReasoningLevel(record.reasoningLevel) ? record.reasoningLevel : null,
    // The wire vocabulary becomes the picker's here, once, at the store.
    permissionMode: executionModeFromWire(record.permissionMode),
  }
}

/** Exactly the fields this module maps from a stored project. */
export interface ProjectRecordLike {
  readonly id: string
  readonly name: string
  readonly icon: Project['icon']
  readonly description: string
  readonly folders: readonly { readonly id: string; readonly name: string; readonly path: string }[]
  readonly createdAt: number
}

export function mapProject(project: ProjectRecordLike): Project {
  return {
    id: project.id,
    name: project.name,
    icon: project.icon,
    description: project.description,
    folders: project.folders.map((folder) => ({
      id: folder.id,
      name: folder.name,
      path: folder.path,
    })),
    // A checked-out branch is git's fact to report. Until some surface
    // reports it, there is none to show - which IdentityLine already
    // renders as "no branch control".
    branch: null,
    branches: [],
    createdAt: project.createdAt,
  }
}

export const EMPTY_CATALOG: ModelCatalogState = {
  phase: { status: 'loading', error: null },
  connections: [],
  models: [],
  defaults: {},
}

/**
 * The catalog, from the three reads it is made of.
 *
 * Each read fails on its own, and the state keeps what the earlier ones
 * answered: connections that loaded are still the connections when the
 * models did not, and both stand when only the defaults failed. `held` is
 * what the store had before, for the one case that keeps it - a models
 * failure keeps the previous models rather than blanking the picker.
 */
export function catalogState(
  held: ModelCatalogState,
  connections: HarnessResult<readonly ProviderConnection[]>,
  models: HarnessResult<readonly ProviderModel[]>,
  defaults: HarnessResult<DefaultSelection>,
): ModelCatalogState {
  if (!connections.ok) {
    return {
      phase: { status: 'failed', error: connections.error },
      connections: [],
      models: [],
      defaults: {},
    }
  }
  if (!models.ok) {
    return {
      ...held,
      phase: { status: 'failed', error: models.error },
      connections: connections.value,
    }
  }
  if (!defaults.ok) {
    return {
      phase: { status: 'failed', error: defaults.error },
      connections: connections.value,
      models: catalogFrom(connections.value, models.value),
      defaults: {},
    }
  }
  return {
    phase: { status: 'ready', error: null },
    connections: connections.value,
    models: catalogFrom(connections.value, models.value),
    defaults: defaults.value,
  }
}
