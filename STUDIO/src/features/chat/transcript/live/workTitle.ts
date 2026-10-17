import type { ToolCallView } from '@/features/chat/transcript/projection'
import { recordedChanges } from '@/features/changes/recordedChanges'
import { readMediaCall } from './mediaCall'
import { resultState } from './toolResult'

/** A compact account of recorded results, independent of the answer's prose. */
export function workTitle(calls: readonly ToolCallView[]): string {
  const changes = recordedChanges(calls)
  const media = calls.flatMap((call) => resultState(call) === 'success' ? readMediaCall(call)?.artifacts ?? [] : [])
  const artifacts = [...new Map(media.map((artifact) => [artifact.path, artifact])).values()]
  if (changes.length > 0 && artifacts.length > 0) return 'File changes and generated media'
  if (changes.length === 1) {
    const change = changes[0]
    const name = change.path.replace(/\\/g, '/').split('/').filter(Boolean).pop() ?? change.path
    // A very long basename still must not turn the disclosure into a paragraph.
    if (name.length <= 64) return `${change.action === 'Edited' ? 'Updated' : change.action} ${name}`
  }
  if (changes.length > 0) {
    const actions = new Set(changes.map((change) => change.action))
    const verb = actions.size === 1 ? changes[0].action === 'Edited' ? 'Updated' : changes[0].action : 'Updated'
    return `${verb} ${changes.length === 1 ? 'a file' : `${changes.length} files`}`
  }
  if (artifacts.length > 0) {
    const images = artifacts.every((artifact) => artifact.mimeType.startsWith('image/'))
    const videos = artifacts.every((artifact) => artifact.mimeType.startsWith('video/'))
    const noun = images ? 'image' : videos ? 'video' : 'media artifact'
    return `Generated ${artifacts.length === 1 ? `${images ? 'an' : 'a'} ${noun}` : `${artifacts.length} ${noun}s`}`
  }
  return 'Completed work'
}
