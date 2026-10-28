import { resolveHarnessAddress } from '@/platform/harness'
import { createRequester } from '@/platform/harness/client/request'
import { isRecord } from '@/lib/guards'

/**
 * The two model choices a voice call has: the model it talks with, and the
 * model its background tasks work on (D9). Null for tasks means the chat's
 * own model, which is the default and what tasks always used.
 */
export type VoiceModelRole = 'conversation' | 'tasks'

const PATHS: Readonly<Record<VoiceModelRole, string>> = {
  conversation: '/api/media/voice-model',
  tasks: '/api/media/voice-task-model',
}

export async function voiceModelSetting(change?: { modelId: string | null }, role: VoiceModelRole = 'conversation') {
  const address = await resolveHarnessAddress()
  if (address === null) return { ok: false as const, error: { message: 'Start Studio\'s harness to configure voice.' } }
  return createRequester(address).json(change === undefined ? 'GET' : 'PUT', PATHS[role], change, (value) => {
    if (!isRecord(value) || (value.modelId !== null && typeof value.modelId !== 'string')) return null
    return { modelId: value.modelId }
  })
}
