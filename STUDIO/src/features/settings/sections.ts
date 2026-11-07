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
 * The side panel lists the groups and opens one at a time, so seven rows and
 * the pages of one group are all it ever shows, and it does not need to scroll.
 */

export interface SettingsSection {
  readonly id: string
  readonly name: string
  readonly icon: IconComponent
}

export interface SettingsGroup {
  readonly id: string
  readonly name: string
  readonly icon: IconComponent
  readonly sections: readonly SettingsSection[]
}

export const SETTINGS_GROUPS: readonly SettingsGroup[] = [
  {
    id: 'application',
    name: 'Application',
    icon: Icons.general,
    sections: [
      { id: 'general', name: 'General', icon: Icons.general },
      { id: 'appearance', name: 'Appearance', icon: Icons.appearance },
      // Under Application because it is about the program's reach, not about
      // an extension or a model: the same Studio, rendered on another screen.
      { id: 'devices', name: 'Other devices', icon: Icons.devices },
      { id: 'shortcuts', name: 'Shortcuts', icon: Icons.shortcuts },
      { id: 'diagnostics', name: 'Diagnostics', icon: Icons.general },
    ],
  },
  {
    id: 'account',
    name: 'Account',
    icon: Icons.account,
    sections: [
      { id: 'account', name: 'Account', icon: Icons.account },
      // The library sits with the person, not the agent: it is what they
      // keep, and every conversation reads it.
      { id: 'library', name: 'Library', icon: Icons.library },
      { id: 'personalization', name: 'Personalization', icon: Icons.personalization },
    ],
  },
  {
    // Provider is the category; the three pages are the three kinds a
    // connection can serve, in the contract's own words. One key added on
    // any page serves every kind its vendor can, and shows on each page
    // with that page's models.
    id: 'providers',
    name: 'Providers',
    icon: Icons.providers,
    sections: [
      { id: 'models', name: 'Models', icon: Icons.providers },
      { id: 'media', name: 'Media', icon: Icons.generate },
      { id: 'tools', name: 'Tools', icon: Icons.tools },
    ],
  },
  {
    id: 'extensions',
    name: 'Extensions',
    icon: Icons.mcp,
    sections: [
      { id: 'mcp', name: 'MCP servers', icon: Icons.mcp },
      { id: 'connectors', name: 'Connectors', icon: Icons.connector },
      { id: 'browser-use', name: 'Browser and computer use', icon: Icons.browserUse },
    ],
  },
  {
    id: 'agent',
    name: 'Agent',
    icon: Icons.agents,
    sections: [
      // First: it answers the group's own question before anything else in
      // it. What the agent may do was decided by an approval, and the
      // approvals are the one thing here a person can take back.
      { id: 'permissions', name: 'Permissions', icon: Icons.permissions },
      { id: 'skills', name: 'Skills', icon: Icons.skill },
      // The agents the harness has, read-only: the definitions live in the
      // harness's code, so this pane is a window onto them, not a form.
      { id: 'agents', name: 'Agents', icon: Icons.agents },
      // Under Agent beside skills: a command is a prompt the person keeps,
      // and what it drives is the agent, not the program.
      { id: 'commands', name: 'Commands', icon: Icons.command },
      { id: 'hooks', name: 'Hooks', icon: Icons.hook },
    ],
  },
  {
    id: 'coding',
    name: 'Coding',
    icon: Icons.coding,
    sections: [
      { id: 'git', name: 'Git', icon: Icons.branch },
      { id: 'worktrees', name: 'Worktrees', icon: Icons.worktree },
      { id: 'environments', name: 'Environments', icon: Icons.coding },
    ],
  },
  {
    id: 'archived',
    name: 'Archived',
    icon: Icons.archive,
    sections: [{ id: 'archive', name: 'Archived chats', icon: Icons.archive }],
  },
]

export const ALL_SECTIONS: readonly SettingsSection[] = SETTINGS_GROUPS.flatMap(
  (group) => group.sections,
)

export function findSection(id: string): SettingsSection | undefined {
  return ALL_SECTIONS.find((section) => section.id === id)
}

/** The group holding a page. */
export function groupOf(sectionId: string): SettingsGroup | undefined {
  return SETTINGS_GROUPS.find((group) => group.sections.some((section) => section.id === sectionId))
}
