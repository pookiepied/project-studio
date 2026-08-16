import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import { DEMO_PROJECTS } from '@/features/projects/demo'
import type {
  ChatThread,
  Project,
  ProjectFile,
  ProjectIconId,
  ProjectNote,
  ProjectTask,
} from '@/features/projects/types'

export interface NewProjectInput {
  name: string
  icon: ProjectIconId
  folders: string[]
}

interface ProjectsContextValue {
  projects: Project[]
  getProject: (id: string) => Project | undefined
  createProject: (input: NewProjectInput) => Project
  createChat: (projectId: string) => ChatThread
  /** Check out one of the project's branches. Demo-only: it moves a label. */
  setBranch: (projectId: string, branch: string) => void
  addNote: (projectId: string) => ProjectNote
  updateNote: (projectId: string, noteId: string, patch: Partial<Pick<ProjectNote, 'title' | 'body'>>) => void
  removeNote: (projectId: string, noteId: string) => void
  addTask: (projectId: string, title: string) => void
  toggleTask: (projectId: string, taskId: string) => void
  addFile: (projectId: string, file: Omit<ProjectFile, 'id'>) => void
  removeFile: (projectId: string, fileId: string) => void
}

const ProjectsContext = createContext<ProjectsContextValue | null>(null)

let sequence = 0
/** Demo ids only — unique within the session, stable enough for keys. */
function nextId(prefix: string): string {
  sequence += 1
  return `${prefix}-${Date.now().toString(36)}-${sequence}`
}

/**
 * Owns every project and every action that changes one. Demo-only: state is
 * in memory, seeded from `demo.ts`, and talks to nothing. When the harness
 * lands this provider becomes the seam where real records arrive — consumers
 * code against the context, never against the demo file.
 */
export function ProjectsProvider({ children }: { children: ReactNode }) {
  const [projects, setProjects] = useState<Project[]>(DEMO_PROJECTS)

  const patchProject = useCallback((projectId: string, patch: (project: Project) => Project) => {
    setProjects((current) =>
      current.map((project) => (project.id === projectId ? patch(project) : project)),
    )
  }, [])

  const getProject = useCallback(
    (id: string) => projects.find((project) => project.id === id),
    [projects],
  )

  const createProject = useCallback((input: NewProjectInput): Project => {
    // A project is born with one conversation so the chat tab always has
    // somewhere to land — the Codex-style empty project felt dead in review.
    const firstChat: ChatThread = { id: nextId('chat'), title: 'New conversation' }
    const project: Project = {
      id: nextId('project'),
      name: input.name,
      icon: input.icon,
      folders: input.folders,
      chats: [firstChat],
      notes: [],
      tasks: [],
      files: [],
    }
    setProjects((current) => [project, ...current])
    return project
  }, [])

  const createChat = useCallback(
    (projectId: string): ChatThread => {
      const chat: ChatThread = { id: nextId('chat'), title: 'New conversation' }
      patchProject(projectId, (project) => ({ ...project, chats: [...project.chats, chat] }))
      return chat
    },
    [patchProject],
  )

  const setBranch = useCallback(
    (projectId: string, branch: string) => {
      patchProject(projectId, (project) => ({ ...project, branch }))
    },
    [patchProject],
  )

  const addNote = useCallback(
    (projectId: string): ProjectNote => {
      const note: ProjectNote = { id: nextId('note'), title: '', body: '', updatedAt: 'Now' }
      patchProject(projectId, (project) => ({ ...project, notes: [note, ...project.notes] }))
      return note
    },
    [patchProject],
  )

  const updateNote = useCallback(
    (projectId: string, noteId: string, patch: Partial<Pick<ProjectNote, 'title' | 'body'>>) => {
      patchProject(projectId, (project) => ({
        ...project,
        notes: project.notes.map((note) =>
          note.id === noteId ? { ...note, ...patch, updatedAt: 'Now' } : note,
        ),
      }))
    },
    [patchProject],
  )

  const removeNote = useCallback(
    (projectId: string, noteId: string) => {
      patchProject(projectId, (project) => ({
        ...project,
        notes: project.notes.filter((note) => note.id !== noteId),
      }))
    },
    [patchProject],
  )

  const addTask = useCallback(
    (projectId: string, title: string) => {
      const task: ProjectTask = { id: nextId('task'), title, done: false }
      patchProject(projectId, (project) => ({ ...project, tasks: [...project.tasks, task] }))
    },
    [patchProject],
  )

  const toggleTask = useCallback(
    (projectId: string, taskId: string) => {
      patchProject(projectId, (project) => ({
        ...project,
        tasks: project.tasks.map((task) =>
          task.id === taskId ? { ...task, done: !task.done } : task,
        ),
      }))
    },
    [patchProject],
  )

  const addFile = useCallback(
    (projectId: string, file: Omit<ProjectFile, 'id'>) => {
      patchProject(projectId, (project) => ({
        ...project,
        files: [{ ...file, id: nextId('file') }, ...project.files],
      }))
    },
    [patchProject],
  )

  const removeFile = useCallback(
    (projectId: string, fileId: string) => {
      patchProject(projectId, (project) => ({
        ...project,
        files: project.files.filter((file) => file.id !== fileId),
      }))
    },
    [patchProject],
  )

  const value = useMemo<ProjectsContextValue>(
    () => ({
      projects,
      getProject,
      createProject,
      createChat,
      setBranch,
      addNote,
      updateNote,
      removeNote,
      addTask,
      toggleTask,
      addFile,
      removeFile,
    }),
    [
      projects,
      getProject,
      createProject,
      createChat,
      setBranch,
      addNote,
      updateNote,
      removeNote,
      addTask,
      toggleTask,
      addFile,
      removeFile,
    ],
  )

  return <ProjectsContext.Provider value={value}>{children}</ProjectsContext.Provider>
}

export function useProjects(): ProjectsContextValue {
  const context = useContext(ProjectsContext)
  if (!context) throw new Error('useProjects must be used within ProjectsProvider')
  return context
}
