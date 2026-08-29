import { Icons } from '@/components/icons'
import type { IconComponent } from '@/components/icons'

/**
 * The settings tree.
 *
 * Declared as data rather than as JSX so the navigation, the routing, and the
 * command palette all read the same list. Groups are sorted by how directly a
 * section answers the question a person opens Settings with, and the grouping
 * is the argument -- each group is one kind of thing, named for what its
 * members *are* rather than for where they used to sit:
 *
 *   Application  the program itself: how it behaves, looks, and is driven
 *   Account      you: who is signed in, and what Studio knows about you
 *   Models       where replies come from
 *   Extensions   things that widen what Studio can reach
 *   Agent        what the agent can do, and what wraps around its actions
 *   Coding       how it works in a repository
 *   Archived     conversations you kept but put away
 *
 * The grouping this replaces filed every one of the first six under two
 * headings, Personal and Extensions, and the filing was the bug. Account sat
 * beside Appearance under a heading about "you and this machine", which is two
 * different questions -- one about identity, one about the window. Providers
 * sat under Extensions, but a provider is the opposite of an extension: it is
 * the engine everything else runs on, and reach is what it serves. Skills and
 * Hooks sat under Coding because they change behaviour in a repository, yet a
 * skill is a capability of the agent and a hook is automation around the
 * agent's actions -- neither knows a repository exists. Each of those moves is
 * a section filed under what it was near instead of what it is.
 *
 * Three groups carry a single section on purpose. A one-row group that says
 * "Models" answers "where do I change what answers me?" in one glance; folding
 * Providers under a wider heading to avoid the orphan is the filing instinct
 * that produced the old tree in the first place.
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
    id: 'application',
    name: 'Application',
    sections: [
      { id: 'general', name: 'General', icon: Icons.general },
      { id: 'appearance', name: 'Appearance', icon: Icons.appearance },
      { id: 'shortcuts', name: 'Keyboard shortcuts', icon: Icons.shortcuts },
    ],
  },
  {
    id: 'account',
    name: 'Account',
    sections: [
      { id: 'account', name: 'Account', icon: Icons.account },
      { id: 'personalization', name: 'Personalization', icon: Icons.personalization },
    ],
  },
  {
    id: 'models',
    name: 'Models',
    sections: [{ id: 'providers', name: 'Providers', icon: Icons.providers }],
  },
  {
    id: 'extensions',
    name: 'Extensions',
    sections: [
      { id: 'mcp', name: 'MCP servers', icon: Icons.mcp },
      { id: 'connectors', name: 'Connectors', icon: Icons.connector },
      { id: 'browser-use', name: 'Browser and computer use', icon: Icons.browserUse },
    ],
  },
  {
    id: 'agent',
    name: 'Agent',
    sections: [
      { id: 'skills', name: 'Skills', icon: Icons.skill },
      { id: 'hooks', name: 'Hooks', icon: Icons.hook },
    ],
  },
  {
    id: 'coding',
    name: 'Coding',
    sections: [
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
