import type { ToolCallView } from '@/features/chat/transcript/projection'
import { familyOf } from './reportFamily'
import { mediaKind } from './mediaCall'
import { webKind } from './webCall'

/** Activity names describe attempts; outcomes remain on their individual rows. */
export function activitySummary(calls: readonly ToolCallView[]): string {
  const labels = new Set<string>()
  for (const call of calls) {
    const name = call.toolName
    const family = familyOf(name)
    labels.add(family?.id === 'browser' ? 'used the browser' : family?.id === 'computer' ? 'used the computer'
      : name === 'read' ? 'read files'
        : ['edit', 'write', 'move', 'delete'].includes(name) ? 'changed files'
          : ['shell', 'git'].includes(name) ? 'ran commands'
            : ['glob', 'grep'].includes(name) ? 'searched files'
              : name === 'plan' ? 'updated the plan'
                : name === 'discover' ? 'looked up tools'
                  : name === 'task' ? 'delegated work'
                    : name === 'jobs' ? 'checked background work'
                      : name.startsWith('library_') ? 'used the library'
                        : mediaKind(name) !== null ? 'generated media'
                          : webKind(name) !== null ? 'researched the web' : 'used tools')
  }
  const text = [...labels].join(', ')
  return text === '' ? 'Activity' : text.charAt(0).toUpperCase() + text.slice(1)
}
