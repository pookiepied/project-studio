/**
 * The project model.
 *
 * A project is where work lives: it gathers source folders the agent may read,
 * the conversations about the work, and the project-management pieces — notes,
 * tasks, files, links and transcriptions. Everything here is demo state held in
 * memory by `ProjectsProvider`; the harness will own the real records later.
 */

/** Keys into `PROJECT_ICONS` — monochrome glyphs, one per project. */
export type ProjectIconId =
  | 'folder'
  | 'rocket'
  | 'palette'
  | 'book'
  | 'code'
  | 'music'
  | 'camera'
  | 'flask'
  | 'briefcase'

export interface ChatThread {
  id: string
  title: string
}

export interface ProjectNote {
  id: string
  title: string
  body: string
  updatedAt: string
}

export interface ProjectTask {
  id: string
  title: string
  done: boolean
}

/** A file dropped in, a link saved, or a voice transcription. */
export interface ProjectFile {
  id: string
  kind: 'file' | 'link' | 'transcription'
  name: string
  /** Size for files, domain for links, duration for transcriptions. */
  meta: string
}

export interface Project {
  id: string
  name: string
  icon: ProjectIconId
  /**
   * The checked-out branch, present only when the project's source folders
   * belong to a Git worktree. Non-Git projects have neither this nor
   * `branches`, and the title bar shows no branch control at all — an empty
   * switcher is worse than no switcher.
   */
  branch?: string
  /** Branches offered by the title-bar switcher. Always contains `branch`. */
  branches?: string[]
  /** Source folders the project reads from — as many as the user wants. */
  folders: string[]
  chats: ChatThread[]
  notes: ProjectNote[]
  tasks: ProjectTask[]
  files: ProjectFile[]
}
