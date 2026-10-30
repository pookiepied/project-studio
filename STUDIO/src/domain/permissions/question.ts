import type { GrantDuration, PendingApprovalRecord } from '@/platform/harness'

/**
 * A permission question, in the words the prompt shows.
 *
 * The wire record describes the request the way the kernel sees it: a
 * capability id, a resolved resource, a scope ladder. None of that is a
 * sentence. This mapping is the one place that turns it into one, so the
 * register - "Write `index.html` in this conversation's workspace" - is
 * decided here and nowhere else. The capability id is deliberately not part
 * of what a person sees; it is what the kernel stores, and the two vocabularies
 * do not meet anywhere but this file.
 */

/** One run of the action sentence: plain prose, or the thing being touched. */
export interface QuestionTextPart {
  readonly kind: 'text' | 'code'
  readonly text: string
}

export interface PermissionQuestion {
  readonly id: string
  /** When the kernel raised it. The queue is answered oldest first. */
  readonly createdAt: number
  /**
   * The agent whose call raised the question, when it was a delegate's -
   * `general`, `explore` - and null for the conversation agent's own. A
   * delegate asks under its own name (ADR 0058), so the prompt says who is
   * asking and the person answering knows which agent a lasting grant will
   * be keyed to.
   */
  readonly agentId: string | null
  /** The action sentence, in order, code parts set in the mono face. */
  readonly sentence: readonly QuestionTextPart[]
  /**
   * The kernel's own reason for asking, verbatim, and only when it says
   * something the sentence cannot: a policy ask (third-party code, git
   * reaching the network) survives every mode, so in Auto it is the one
   * explanation on screen. A default ask's reason - the capability "has not
   * been approved yet" - is the question restated, and is left off.
   */
  readonly reason: string | null
  /**
   * The rung a lasting answer is stored against, or null when the only honest
   * answer is the narrowest one.
   *
   * "Just once" always uses the narrowest rung, because it authorizes the call
   * in front of the person and stores nothing. The other two durations say
   * they last - and a grant pinned to the single file the run happened to name
   * first does not last in any way a person would recognise: the next file in
   * the same folder asks again, in the same conversation they just said yes
   * to. So a lasting answer is stored against the folder the kernel itself
   * offered, when it offered one.
   *
   * Never `this-capability`. That rung is every use of the tool anywhere, and
   * choosing it on someone's behalf because they picked a duration would be
   * granting something they were not asked about. A question with no folder
   * rung - a command, which is already approved by program name - keeps the
   * narrowest rung for every duration.
   */
  readonly lastingScopeId: string | null
  /** The longest answer the kernel accepts; the prompt offers nothing longer. */
  readonly maxDuration: GrantDuration
}

/**
 * The verbs, for the capabilities that can actually stop and ask today. A
 * native path tool writes or edits a file; a command-kind tool runs something.
 * Anything outside this table falls back to the harness's own title for the
 * capability, which is the honest answer for a capability this mapping has
 * never met.
 */
const PATH_VERBS: Record<string, string> = {
  write: 'Write',
  edit: 'Edit',
  read: 'Read',
}

const COMMAND_VERBS: Record<string, string> = {
  shell: 'Run',
  git: 'Run',
}

/** What the command resource names, as the person would say it. */
function commandTarget(resource: string): string {
  const separator = resource.indexOf(':')
  if (separator < 0) return resource
  const prefix = resource.slice(0, separator)
  const rest = resource.slice(separator + 1)
  if (prefix === 'shell') return rest
  if (prefix === 'git') return `git ${rest}`
  return resource
}

/**
 * The file being touched, said the way a person can act on it.
 *
 * The workspace-relative path, not the bare filename: a consent prompt has to
 * identify the thing unambiguously, and a project with `src/index.html` and
 * `dist/index.html` in it produces two questions that read identically if only
 * the name is shown. The root comes from the `this-folder` rung of the ladder
 * the kernel already offered - its pattern is the workspace plus `/**` - so
 * nothing new has to be sent to say where the file is.
 *
 * The two patterns arrive with different separators (the file pattern keeps
 * Windows backslashes, the folder pattern is written with forward slashes),
 * so both are normalized before they are compared. Without that the prefix
 * never matches on Windows and every path silently falls back to its name.
 */
function pathTarget(resource: string, folderPattern: string | null): string {
  const unified = resource.replaceAll('\\', '/')
  const name = unified.slice(unified.lastIndexOf('/') + 1) || unified

  if (folderPattern === null) return name
  const root = folderPattern.replaceAll('\\', '/').replace(/\/?\*+$/, '')
  if (root === '' || !unified.startsWith(`${root}/`)) return name

  const relative = unified.slice(root.length + 1)
  return relative === '' ? name : relative
}

/** Whether a resource sits under a `root/**` folder pattern, separators unified. */
function insidePattern(resource: string, pattern: string): boolean {
  const unified = resource.replaceAll('\\', '/')
  const root = pattern.replaceAll('\\', '/').replace(/\/?\*+$/, '')
  return root !== '' && (unified === root || unified.startsWith(`${root}/`))
}

/**
 * Which kind of thing the question touches, read from the scope ladder the
 * kernel itself offered: `this-command` means a command line, `this-file`
 * means a path, and neither means the capability is the whole of what is
 * being approved.
 */
function kindOf(record: PendingApprovalRecord): 'command' | 'path' | 'capability' {
  for (const scope of record.scopes) {
    if (scope.id === 'this-command') return 'command'
    if (scope.id === 'this-file') return 'path'
  }
  return 'capability'
}

/**
 * Where a path inside the workspace is said to be.
 *
 * The working directory of a project conversation is the person's own
 * folder, and calling that "this conversation's workspace" paints it as
 * Studio's scratch space when it is their code. With no project the phrase
 * is exactly right: the directory is one Studio made for the conversation.
 */
function insideWorkspace(hasProject: boolean): string {
  return hasProject ? ' in this project.' : " in this conversation's workspace."
}

function sentenceFor(record: PendingApprovalRecord, hasProject: boolean): readonly QuestionTextPart[] {
  const kind = kindOf(record)
  const resource = record.resource

  if (kind === 'path' && resource !== null) {
    const verb = PATH_VERBS[record.capabilityName] ?? record.capabilityTitle
    const folder = record.scopes.find((scope) => scope.id === 'this-folder')?.pattern ?? null
    // The project rung is the workspace root, and the kernel offers it
    // whether or not the path is inside it. A path it does not cover is one
    // the person granted beyond the workspace - the Downloads folder the
    // model asked for - and saying "in this conversation's workspace" about
    // it would be the prompt misnaming what it asks consent for. Named by
    // its folder instead.
    const project = record.scopes.find((scope) => scope.id === 'this-project')?.pattern ?? null
    if (project !== null && !insidePattern(resource, project)) {
      const unified = resource.replaceAll('\\', '/')
      const cut = unified.lastIndexOf('/')
      return [
        { kind: 'text', text: `${verb} ` },
        { kind: 'code', text: unified.slice(cut + 1) || unified },
        { kind: 'text', text: ' in ' },
        { kind: 'code', text: cut <= 0 ? unified : resource.slice(0, cut) },
        { kind: 'text', text: '.' },
      ]
    }
    return [
      { kind: 'text', text: `${verb} ` },
      { kind: 'code', text: pathTarget(resource, folder) },
      { kind: 'text', text: insideWorkspace(hasProject) },
    ]
  }

  if (kind === 'command' && resource !== null) {
    const known = COMMAND_VERBS[record.capabilityName] !== undefined
    if (known) {
      const verb = COMMAND_VERBS[record.capabilityName]
      return [
        { kind: 'text', text: `${verb} ` },
        { kind: 'code', text: commandTarget(resource) },
        { kind: 'text', text: '.' },
      ]
    }
    return [
      { kind: 'text', text: `${record.capabilityTitle} (` },
      { kind: 'code', text: resource },
      { kind: 'text', text: ').' },
    ]
  }

  // The capability is the whole of what is being approved, or this mapping
  // has never met the shape. The harness's own title carries the meaning.
  const target = resource === null ? [] : [{ kind: 'code' as const, text: resource }]
  return [
    { kind: 'text', text: `Use ${record.capabilityTitle}` },
    ...(target.length > 0
      ? [{ kind: 'text' as const, text: ' (' }, ...target, { kind: 'text' as const, text: ')' }]
      : []),
    { kind: 'text', text: '.' },
  ]
}

/**
 * The display name of the agent a question is attributed to, or null when it
 * needs none: the conversation agent's own ask (its scope carries `studio`,
 * and the card is Studio speaking) or a record without an agent at all. The
 * known delegates are named by their definition's title; an unknown id is
 * named by itself, the honest fallback for an agent this file has never met.
 */
export function agentAttribution(agentId: string | null): string | null {
  if (agentId === null || agentId === 'studio') return null
  const known: Record<string, string> = {
    general: 'General',
    explore: 'Explorer',
    plan: 'Planner',
  }
  return `${known[agentId] ?? agentId} agent`
}

/** The wire row becomes the question the prompt renders. */
export function questionFromRecord(
  record: PendingApprovalRecord,
  options: { readonly hasProject?: boolean } = {},
): PermissionQuestion {
  return {
    id: record.id,
    createdAt: record.createdAt,
    agentId: record.agentId,
    sentence: sentenceFor(record, options.hasProject ?? false),
    reason: record.source === 'policy' ? record.reason : null,
    lastingScopeId:
      record.scopes.find((scope) => scope.id === 'this-folder')?.id ?? null,
    maxDuration: record.maxDuration,
  }
}
