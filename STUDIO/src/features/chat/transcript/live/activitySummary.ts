import { Icons, type IconComponent } from '@/components/icons'
import type { ToolCallView } from '@/features/chat/transcript/projection'
import { familyOf } from './reportFamily'
import { mediaKind } from './mediaCall'
import { webKind } from './webCall'
import { resultState } from './toolResult'

interface ActivityKind {
  readonly label: string
  readonly running: string
  readonly mark: IconComponent
}

const KINDS: Readonly<Record<string, ActivityKind>> = {
  read: { label: 'read files', running: 'Reading files', mark: Icons.fileRead },
  change: { label: 'changed files', running: 'Changing files', mark: Icons.edit },
  command: { label: 'ran commands', running: 'Running commands', mark: Icons.run },
  search: { label: 'searched files', running: 'Searching files', mark: Icons.search },
  plan: { label: 'updated the plan', running: 'Updating the plan', mark: Icons.plan },
  discover: { label: 'looked up tools', running: 'Looking up tools', mark: Icons.mcp },
  task: { label: 'delegated work', running: 'Delegating work', mark: Icons.branch },
  jobs: { label: 'checked background work', running: 'Checking background work', mark: Icons.backgroundJobs },
  library: { label: 'used the library', running: 'Using the library', mark: Icons.library },
  ask: { label: 'asked a question', running: 'Asking a question', mark: Icons.ask },
  image: { label: 'generated images', running: 'Generating images', mark: Icons.image },
  video: { label: 'generated videos', running: 'Generating videos', mark: Icons.video },
  web: { label: 'researched the web', running: 'Researching the web', mark: Icons.browserUse },
}

const OTHER: ActivityKind = { label: 'used tools', running: 'Using tools', mark: Icons.mcp }

/** Group labels and marks share one classification; unfamiliar extensions stay generic. */
function kindOf(toolName: string): ActivityKind {
  const family = familyOf(toolName)
  if (family !== null) return {
    label: `used the ${family.id}`, running: `Using the ${family.id}`, mark: family.Mark,
  }
  const name = toolName.replace(/^native_/, '')
  const kind = ['edit', 'write', 'move', 'delete'].includes(name) ? 'change'
    : ['shell', 'git'].includes(name) ? 'command'
      : ['glob', 'grep'].includes(name) ? 'search'
        : name === 'ocr' ? 'read'
          : ['ask_user_question', 'request_folder'].includes(name) ? 'ask'
            : name.startsWith('library_') ? 'library'
              : mediaKind(toolName) ?? (webKind(toolName) !== null ? 'web' : name)
  return KINDS[kind] ?? OTHER
}

/** Derived from wire facts on every update, with no second lifecycle to synchronize. */
export function activityState(calls: readonly ToolCallView[], active: boolean) {
  const kinds = calls.map((call) => kindOf(call.toolName))
  const unanswered = calls.filter((call) => call.errorText === null && !call.output?.present)
  const current = active ? unanswered[unanswered.length - 1] : undefined
  return {
    summary: activitySummary(calls),
    // The first kind owns the mark so parallel completions do not make it flicker.
    mark: kinds[0]?.mark ?? OTHER.mark,
    current,
    running: current === undefined ? null : kindOf(current.toolName).running,
    failed: calls.filter((call) => resultState(call) === 'failed').length,
    unfinished: !active && unanswered.length > 0,
  }
}

/** Activity names describe attempts; outcomes remain on their individual rows. */
export function activitySummary(calls: readonly ToolCallView[]): string {
  const labels = new Set<string>()
  for (const call of calls) {
    labels.add(kindOf(call.toolName).label)
  }
  const text = [...labels].join(', ')
  return text === '' ? 'Activity' : text.charAt(0).toUpperCase() + text.slice(1)
}
