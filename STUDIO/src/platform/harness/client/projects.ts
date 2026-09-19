import {
  parseFolderListing,
  parseFolderTrust,
  parseProjectRecord,
  parseProjectRecords,
  parseIsolationInfo,
  parseSandboxScopeInfo,
  parseShellInfo,
  type FolderListing,
  type IsolationInfo,
  type FolderTrust,
  type ProjectCreateDraft,
  type ProjectFolderSpec,
  type ProjectPatch,
  type ProjectRecord,
  type SandboxLevel,
  type SandboxScopeInfo,
  type ShellInfo,
  type ShellKind,
  type SandboxScopeMode,
  type SandboxScopeSource,
} from '../contracts'
import type { HarnessResult, Requester } from './request'

/**
 * `/api/projects` and `/api/sandbox`: a project, its folders, and the wall
 * around them - the scope rows, the level, the folder trust, and the
 * listing the folder picker walks.
 */

const PROJECTS_PATH = '/api/projects'
const SANDBOX_PATH = '/api/sandbox'

export interface ProjectClient {
  listProjects(): Promise<HarnessResult<readonly ProjectRecord[]>>
  createProject(draft: ProjectCreateDraft): Promise<HarnessResult<ProjectRecord>>
  updateProject(id: string, patch: ProjectPatch): Promise<HarnessResult<ProjectRecord>>
  deleteProject(id: string): Promise<HarnessResult<void>>
  addProjectFolder(
    projectId: string,
    folder: ProjectFolderSpec,
  ): Promise<HarnessResult<ProjectRecord>>
  updateProjectFolder(
    projectId: string,
    folderId: string,
    change: { name?: string; path?: string },
  ): Promise<HarnessResult<ProjectRecord>>
  removeProjectFolder(projectId: string, folderId: string): Promise<HarnessResult<ProjectRecord>>

  /**
   * The wall the user can move: scope rows for one project beside the
   * machine-wide rows, and the level the project is held with. `projectId`
   * absent reads the machine-wide rows with a contained level, which is what
   * a conversation with no project gets.
   */
  getScope(projectId?: string): Promise<HarnessResult<SandboxScopeInfo>>
  /** Grants one path, for one project or - with an empty id - everywhere. */
  grantScope(input: {
    readonly projectId?: string
    readonly path: string
    readonly mode: SandboxScopeMode
    readonly source?: SandboxScopeSource
  }): Promise<HarnessResult<void>>
  /** Takes one grant back. */
  revokeScope(projectId: string, path: string): Promise<HarnessResult<void>>
  /** Removes a folder granted to one conversation alone. */
  revokeConversationScope(conversationId: string, path: string): Promise<HarnessResult<void>>
  /**
   * One directory of the PC, listed by the harness: the folder picker a
   * browser tab needs, since the file system being chosen is the PC's, not
   * the phone's (ADR 0050, step 6). No path names the person's home, where
   * the walk starts. Reading is wider than choosing on purpose - the listing
   * reaches roots and system directories, and refusing them stays the folder
   * write's job, whose sentence this client carries back as a harness-error.
   */
  browseFolders(path?: string): Promise<HarnessResult<FolderListing>>
  /** Sets whether one project is contained at all. */
  setSandboxLevel(projectId: string, level: SandboxLevel): Promise<HarnessResult<void>>
  /** The shells this machine has, which runs lines, and the preference (ADR 0057). */
  getShell(): Promise<HarnessResult<ShellInfo>>
  /** Records the preferred shell by kind; null lets the machine's order decide. */
  setShell(kind: ShellKind | null): Promise<HarnessResult<ShellInfo>>
  /** The sandbox fence switch (ADR 0057): off by default, offered on Linux. */
  getIsolation(): Promise<HarnessResult<IsolationInfo>>
  setIsolation(enabled: boolean): Promise<HarnessResult<IsolationInfo>>
  /**
   * Records the person's answer about one folder: whether they vouch for what
   * is in it. Addressed by path rather than by project, because that is the
   * unit the harness decides on - two projects that attach the same
   * repository share one answer.
   */
  setFolderTrust(root: string, trusted: boolean): Promise<HarnessResult<FolderTrust>>
}

function projectPath(id: string, suffix = ''): string {
  return `${PROJECTS_PATH}/${encodeURIComponent(id)}${suffix}`
}

function foldersPath(projectId: string): string {
  return projectPath(projectId, '/folders')
}

function folderPath(projectId: string, folderId: string): string {
  return `${foldersPath(projectId)}/${encodeURIComponent(folderId)}`
}

export function projectClient({ json, empty }: Requester): ProjectClient {
  return {
    listProjects() {
      return json('GET', PROJECTS_PATH, undefined, parseProjectRecords)
    },

    createProject(draft) {
      return json(
        'POST',
        PROJECTS_PATH,
        {
          ...(draft.id === undefined ? {} : { id: draft.id }),
          name: draft.name,
          icon: draft.icon,
          ...(draft.description === undefined ? {} : { description: draft.description }),
          ...(draft.folders === undefined
            ? {}
            : { folders: draft.folders.map((folder) => ({ ...folder })) }),
        },
        parseProjectRecord,
      )
    },

    updateProject(id, patch) {
      return json('PATCH', projectPath(id), { ...patch }, parseProjectRecord)
    },

    deleteProject(id) {
      return empty('DELETE', projectPath(id))
    },

    addProjectFolder(projectId, folder) {
      return json('POST', foldersPath(projectId), { ...folder }, parseProjectRecord)
    },

    updateProjectFolder(projectId, folderId, change) {
      const body: Record<string, unknown> = {}
      if (change.name !== undefined) body.name = change.name
      if (change.path !== undefined) body.path = change.path
      return json('PATCH', folderPath(projectId, folderId), body, parseProjectRecord)
    },

    removeProjectFolder(projectId, folderId) {
      return json('DELETE', folderPath(projectId, folderId), undefined, parseProjectRecord)
    },

    getScope(projectId) {
      const query =
        projectId === undefined || projectId === ''
          ? ''
          : `?projectId=${encodeURIComponent(projectId)}`
      return json('GET', `${SANDBOX_PATH}/scope${query}`, undefined, parseSandboxScopeInfo)
    },

    grantScope(input) {
      // The route answers 201 with the row; the pane only needs to know it
      // landed, and `empty` reports any 2xx as success without reading a body.
      return empty('POST', `${SANDBOX_PATH}/scope`, {
        ...(input.projectId === undefined ? {} : { projectId: input.projectId }),
        path: input.path,
        mode: input.mode,
        ...(input.source === undefined ? {} : { source: input.source }),
      })
    },

    revokeScope(projectId, path) {
      return empty(
        'DELETE',
        `${SANDBOX_PATH}/scope?projectId=${encodeURIComponent(projectId)}&path=${encodeURIComponent(path)}`,
      )
    },

    revokeConversationScope(conversationId, path) {
      return empty(
        'DELETE',
        `${SANDBOX_PATH}/scope?conversationId=${encodeURIComponent(conversationId)}&path=${encodeURIComponent(path)}`,
      )
    },

    browseFolders(path) {
      // No path is the picker's first ask: the harness answers with the
      // person's home, so this side never has to know where home is.
      const search = path === undefined || path === '' ? '' : `?path=${encodeURIComponent(path)}`
      return json('GET', `${SANDBOX_PATH}/browse${search}`, undefined, parseFolderListing)
    },

    getShell() {
      return json('GET', `${SANDBOX_PATH}/shell`, undefined, parseShellInfo)
    },

    setShell(kind) {
      return json('PUT', `${SANDBOX_PATH}/shell`, { interpreter: kind }, parseShellInfo)
    },

    getIsolation() {
      return json('GET', `${SANDBOX_PATH}/isolation`, undefined, parseIsolationInfo)
    },

    setIsolation(enabled) {
      return json('PUT', `${SANDBOX_PATH}/isolation`, { enabled }, parseIsolationInfo)
    },

    setSandboxLevel(projectId, level) {
      return empty('PUT', `${SANDBOX_PATH}/projects/${encodeURIComponent(projectId)}/level`, {
        level,
      })
    },

    setFolderTrust(root, trusted) {
      return json('PUT', `${SANDBOX_PATH}/trust`, { root, trusted }, parseFolderTrust)
    },
  }
}
