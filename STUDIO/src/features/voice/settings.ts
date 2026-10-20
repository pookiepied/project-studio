import { resolveHarnessAddress } from '@/platform/harness'
import { createRequester } from '@/platform/harness/client/request'
import { isRecord } from '@/lib/guards'

export async function voiceModelSetting(change?: { modelId: string | null }) {
  const address = await resolveHarnessAddress()
  if (address === null) return { ok: false as const, error: { message: 'Start Studio\'s harness to configure voice.' } }
  return createRequester(address).json(change === undefined ? 'GET' : 'PUT', '/api/media/voice-model', change, (value) => {
    if (!isRecord(value) || (value.modelId !== null && typeof value.modelId !== 'string')) return null
    return { modelId: value.modelId }
  })
}
