/**
 * A source folder attached to a project.
 *
 * Path and name are stored separately because the sidebar shows the name and
 * the harness needs the path, and deriving one from the other at the call site
 * is how two callers end up disagreeing about what a folder is called.
 */
interface SourceFolder {
  readonly id: string
  readonly name: string
  readonly path: string
}

/**
 * A project.
 *
 * `icon` is a glyph key rather than an uploaded image: the sidebar is a 52px
 * rail showing marks only, and a rail of user-supplied images is a rail of
 * mismatched colour in an app that has none.
 */
export interface Project {
  readonly id: string
  readonly name: string
  readonly icon: ProjectIcon
  readonly description: string
  readonly folders: readonly SourceFolder[]
  /** The checked-out branch, when the primary folder is a repository. */
  readonly branch: string | null
  /** Branches offered by the switcher. Demo data until the harness reports them. */
  readonly branches: readonly string[]
  readonly createdAt: number
}

/**
 * The marks a project may wear.
 *
 * A closed set, not free choice, and deliberately abstract -- see the note in
 * `ProjectIconMark`. They are named for their geometry rather than for any
 * subject, because the moment a mark is called `flask` someone will reasonably
 * expect picking it to say something about the project.
 */
export const PROJECT_ICONS = [
  'arc',
  'stack',
  'grid',
  'ring',
  'wave',
  'burst',
  'prism',
  'diamond',
] as const

export type ProjectIcon = (typeof PROJECT_ICONS)[number]

export const DEFAULT_PROJECT_ICON: ProjectIcon = 'arc'
