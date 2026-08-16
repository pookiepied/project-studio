/**
 * Where the user is, as one typed value.
 *
 * The shell renders the middle panel from this and nothing else does. There is
 * no view registry any more: the sidebar builds its own tree from the projects
 * provider, so the only thing navigation owns is *location* — which surface,
 * which project, which tab, which chat.
 */

/** Tabs inside a project workspace. */
export type ProjectTab = 'chat' | 'notes' | 'tasks' | 'files'

export type View =
  | { name: 'projects' }
  | { name: 'project'; projectId: string; tab: ProjectTab; chatId: string | null }
  | { name: 'settings' }
