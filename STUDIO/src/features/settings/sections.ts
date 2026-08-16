import { Icons } from '@/components/icons'
import type { IconComponent } from '@/components/icons'

/**
 * The settings tree.
 *
 * Declared as data rather than as JSX so the navigation, the routing, and the
 * command palette all read the same list. Three groups, and the grouping is the
 * argument:
 *
 *   Personal    things about you and this machine
 *   Extensions  things that widen what Studio can reach
 *   Coding      things that change how it works in a repository
 *   Archived    conversations you kept but put away
 *
 * Skills and Hooks sit under Coding rather than Extensions on purpose. An
 * extension adds reach -- a new server, a new connector. A skill or a hook
 * changes behaviour with the reach it already has. Filing them together would
 * make "what can this thing touch?" unanswerable from the tree.
 */

export interface SettingsSection {
  readonly id: string
  readonly name: string
  readonly icon: IconComponent
}

export interface SettingsGroup {
  readonly id: string
  readonly name: string
  readonly sections: readonly SettingsSection[]
}

export const SETTINGS_GROUPS: readonly SettingsGroup[] = [
  {
    id: 'personal',
    name: 'Personal',
    sections: [
      { id: 'general', name: 'General', icon: Icons.general },
      { id: 'appearance', name: 'Appearance', icon: Icons.appearance },
      { id: 'voice', name: 'Voice', icon: Icons.voice },
      { id: 'personalization', name: 'Personalization', icon: Icons.personalization },
      { id: 'shortcuts', name: 'Keyboard shortcuts', icon: Icons.shortcuts },
      { id: 'account', name: 'Account', icon: Icons.account },
    ],
  },
  {
    id: 'extensions',
    name: 'Extensions',
    sections: [
      { id: 'providers', name: 'Providers', icon: Icons.reasoning },
      { id: 'mcp', name: 'MCP servers', icon: Icons.mcp },
      { id: 'connectors', name: 'Connectors', icon: Icons.connector },
      { id: 'browser-use', name: 'Browser and computer use', icon: Icons.browserUse },
    ],
  },
  {
    id: 'coding',
    name: 'Coding',
    sections: [
      { id: 'skills', name: 'Skills', icon: Icons.skill },
      { id: 'hooks', name: 'Hooks', icon: Icons.hook },
      { id: 'git', name: 'Git', icon: Icons.branch },
      { id: 'worktrees', name: 'Worktrees', icon: Icons.worktree },
      { id: 'environments', name: 'Environments', icon: Icons.coding },
    ],
  },
  {
    id: 'archived',
    name: 'Archived',
    sections: [{ id: 'archive', name: 'Archived chats', icon: Icons.archive }],
  },
]

export const ALL_SECTIONS: readonly SettingsSection[] = SETTINGS_GROUPS.flatMap(
  (group) => group.sections,
)

export function findSection(id: string): SettingsSection | undefined {
  return ALL_SECTIONS.find((section) => section.id === id)
}
