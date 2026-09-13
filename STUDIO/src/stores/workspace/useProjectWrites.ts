import { useCallback, useMemo } from 'react'
import type { Project } from '@/domain/projects/types'
import type { HarnessFailure } from '@/platform/harness'
import { newId } from '@/lib/id'
import type { HarnessSync } from '@/stores/workspace/useHarnessSync'
import type { CreatedProject, NewProjectInput, ProjectWrites } from '@/stores/workspace/types'

/**
 * The writes that change which projects exist and what they hold.
 *
 * Optimistic in the same shape as the conversation writes: the row appears
 * at once, the harness is told, and a refusal re-reads the truth rather than
 * reverting a guess. The one difference is `createProject`, which hands the
 * write's verdict back as a promise, because the dialog that asked has to
 * know whether to close.
 */
export function useProjectWrites(sync: HarnessSync): ProjectWrites {
  const { clientRef, liveRef, load, setRemoteProjects, setRemoteConversations } = sync

  const createProject = useCallback(
    (input: NewProjectInput): CreatedProject => {
      const created: Project = {
        id: newId('prj'),
        name: input.name.trim(),
        icon: input.icon,
        description: input.description.trim(),
        folders: input.folders.map((folder) => ({ id: newId('src'), ...folder })),
        branch: input.folders.length > 0 ? 'main' : null,
        branches: input.folders.length > 0 ? ['main'] : [],
        createdAt: Date.now(),
      }
      setRemoteProjects((current) => [...current, created])

      const client = clientRef.current
      if (client === null) {
        return { project: created, written: Promise.resolve(null) }
      }

      const request = client.createProject({
        id: created.id,
        name: created.name,
        icon: created.icon,
        ...(created.description === '' ? {} : { description: created.description }),
        folders: created.folders.map((folder) => ({
          name: folder.name,
          path: folder.path,
        })),
      })
      // The row's truth, unchanged: server-minted folder ids are adopted when
      // the write lands, and a refusal reloads, which is what drops the
      // optimistic row. The dialog reads the same promise through `written`,
      // for the verdict that decides whether it closes at all.
      void request.then(async (result) => {
        if (!liveRef.current) return
        if (!result.ok) {
          await load()
          return
        }
        const stored = result.value
        setRemoteProjects((current) =>
          current.map((project) =>
            project.id === stored.id
              ? {
                  ...project,
                  folders: stored.folders.map((folder) => ({
                    id: folder.id,
                    name: folder.name,
                    path: folder.path,
                  })),
                }
              : project,
          ),
        )
      })
      return {
        project: created,
        written: request.then((result) => (result.ok ? null : result.error)),
      }
    },
    [clientRef, liveRef, load, setRemoteProjects],
  )

  const trustFolders = useCallback(
    async (paths: readonly string[]): Promise<HarnessFailure | null> => {
      const client = clientRef.current
      if (client === null) return null
      // In order and one at a time, stopping at the first refusal: the answer
      // is per folder, so a project whose second folder is refused must still
      // carry the answer about its first rather than losing the whole gesture.
      for (const path of paths) {
        const result = await client.setFolderTrust(path, true)
        if (!result.ok) return result.error
      }
      return null
    },
    [clientRef],
  )

  const removeProject = useCallback(
    (projectId: string) => {
      // Detaches its conversations rather than deleting them - SET NULL at
      // the schema, the same meaning everywhere above it.
      setRemoteProjects((current) => current.filter((project) => project.id !== projectId))
      setRemoteConversations((current) =>
        current.map((conversation) =>
          conversation.projectId === projectId
            ? { ...conversation, projectId: null }
            : conversation,
        ),
      )
      const client = clientRef.current
      if (client === null) return
      void client.deleteProject(projectId).then(async (result) => {
        if (liveRef.current && !result.ok) await load()
      })
    },
    [clientRef, liveRef, load, setRemoteConversations, setRemoteProjects],
  )

  const setBranch = useCallback(
    (projectId: string, branch: string) => {
      // Memory only: branches are git's fact to report, and nothing here stores
      // them.
      setRemoteProjects((current) =>
        current.map((project) => (project.id === projectId ? { ...project, branch } : project)),
      )
    },
    [setRemoteProjects],
  )

  return useMemo(
    () => ({ createProject, trustFolders, removeProject, setBranch }),
    [createProject, trustFolders, removeProject, setBranch],
  )
}
