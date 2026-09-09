import {
  MCP_AUTH_KINDS,
  MCP_TRANSPORTS,
  type McpAuthKind,
  type McpServerDraft,
  type McpServerRecord,
  type McpTransport,
} from '@/platform/harness'

/**
 * The longest purpose sentence the harness will store.
 *
 * Kept in step with `MCP_DESCRIPTION_LIMIT` in the harness by hand, because
 * the two halves of the repo share no code. If they drift, the harness wins
 * and the person meets its refusal instead of this one.
 */
export const DESCRIPTION_LIMIT = 300

/**
 * The dialog's working copy of a server.
 *
 * Every field is a string, because that is what a text input holds and
 * because a half-typed record has to survive being looked at. `args` is text
 * here and a real vector on the wire; `env` is text here and an object on the
 * wire. Parsing happens once, on the way out, in `toDraft`.
 *
 * **No secret field.** The credential is a separate call to a separate route,
 * so this object can be logged, echoed into an error, or serialised into the
 * JSON view without ever being a thing that leaks a key. That is the reason
 * the JSON view is safe to offer at all.
 */
export interface ServerForm {
  readonly id: string
  readonly title: string
  /**
   * One sentence saying what the server is for.
   *
   * Not the name. This is what the model is told about the server before it
   * has any of its tool definitions, so it is the field that decides whether
   * the server is ever reached for. Optional - a server with no sentence is
   * still listed, just without one.
   */
  readonly description: string
  readonly transport: McpTransport
  readonly command: string
  /** One argument per line. See `splitArgs`. */
  readonly args: string
  /** One `NAME=value` per line. */
  readonly env: string
  readonly url: string
  readonly auth: McpAuthKind
  readonly authHeader: string
  readonly authEnvVar: string
  readonly needsNetwork: boolean
}

export const EMPTY_FORM: ServerForm = {
  id: '',
  title: '',
  description: '',
  transport: 'stdio',
  command: '',
  args: '',
  env: '',
  url: '',
  auth: 'none',
  authHeader: '',
  authEnvVar: '',
  needsNetwork: true,
}

export function formFrom(record: McpServerRecord): ServerForm {
  return {
    id: record.id,
    title: record.title,
    description: record.description,
    transport: record.transport,
    command: record.command ?? '',
    args: joinArgs(record.args),
    env: Object.entries(record.env)
      .map(([name, value]) => `${name}=${value}`)
      .join('\n'),
    url: record.url ?? '',
    auth: record.auth,
    authHeader: record.authHeader ?? '',
    authEnvVar: record.authEnvVar ?? '',
    needsNetwork: record.needsNetwork,
  }
}

/**
 * Reads an argument list: one argument per line.
 *
 * It used to split on spaces, with quoting for the cases that needed it, and
 * that was the wrong default for the platform this runs on. Almost every real
 * Windows path contains a space, so the common case was the one that needed
 * the escape hatch, and forgetting it did not fail loudly: the stored server
 * simply held `["C:\Program", "Files\..."]` and exited with "cannot find
 * module C:\Program", which reads like the server is broken rather than like
 * the form mis-parsed the line. One argument per line has no such trap,
 * because there is nothing to remember to do.
 *
 * A line wrapped in matching quotes keeps its contents exactly, which is the
 * only way to write an argument with leading or trailing spaces. Every other
 * line is trimmed, because a stray space at the end of a pasted path is a
 * typing accident every time and never an intention.
 *
 * This is still the ONLY place a string becomes a vector: the harness stores
 * the vector and never re-splits it, and no shell is ever involved, so a
 * metacharacter in an argument is a character rather than syntax.
 */
export function splitArgs(text: string): readonly string[] {
  const out: string[] = []
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (trimmed === '') continue
    const quoted =
      trimmed.length >= 2 &&
      (trimmed.startsWith('"') || trimmed.startsWith("'")) &&
      trimmed.endsWith(trimmed[0] as string)
    out.push(quoted ? trimmed.slice(1, -1) : trimmed)
  }
  return out
}

/**
 * The inverse, for showing a stored vector for editing.
 *
 * An argument that is empty, or that carries leading or trailing space, is
 * written quoted, and that is not a nicety: bare, it would be a blank or
 * loosely-typed line, and `splitArgs` would drop it or trim it — so an
 * argument the server was configured with would change the moment someone
 * opened the edit dialog and saved it again.
 */
export function joinArgs(args: readonly string[]): string {
  return args
    .map((arg) => (arg === '' || arg !== arg.trim() ? `"${arg}"` : arg))
    .join('\n')
}

/**
 * Reads `NAME=value` lines.
 *
 * Everything after the first `=` is the value, so a variable holding a URL or
 * a base64 blob survives. Blank lines and lines with no `=` are skipped rather
 * than refused: someone mid-edit should not be shown an error for a line they
 * have not finished typing.
 *
 * The value is trimmed. A shell would not trim it, but a shell is not what
 * this is: someone typing `PATH= C:\tools` in a form means the path, and the
 * space they typed after the `=` for legibility becomes part of the value and
 * breaks it silently. An argument that genuinely needs surrounding space is
 * not expressible here, and has never been asked for.
 */
export function parseEnv(text: string): Readonly<Record<string, string>> {
  const out: Record<string, string> = {}
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (trimmed === '' || trimmed.startsWith('#')) continue
    const at = trimmed.indexOf('=')
    if (at <= 0) continue
    out[trimmed.slice(0, at).trim()] = trimmed.slice(at + 1).trim()
  }
  return out
}

/**
 * What is wrong with the form, in the order a person would fix it.
 *
 * One message at a time. A list of six complaints about a form somebody has
 * barely started is noise, and the first thing wrong is the thing to say.
 */
export function problemWith(form: ServerForm): string | null {
  if (form.id.trim() === '') return 'Give the server an id.'
  if (!/^[a-z0-9][a-z0-9._-]*$/i.test(form.id.trim())) {
    return 'An id may hold only letters, numbers, dots, dashes and underscores.'
  }
  if (form.title.trim() === '') return 'Give the server a name.'
  // The same limit the harness enforces, said here so the refusal arrives
  // while the person is still looking at the field rather than after a round
  // trip. The sentence ends up in the system prompt of every turn, which is
  // what the limit is actually protecting.
  if (form.description.trim().length > DESCRIPTION_LIMIT) {
    return `Keep the description to one sentence, under ${DESCRIPTION_LIMIT} characters.`
  }

  if (form.transport === 'stdio') {
    if (form.command.trim() === '') return 'Give the command that starts the server.'
    // The harness refuses these outright, so saying it here saves a round trip
    // and explains it while the person is still looking at the field. Running
    // one needs a command shell, and a shell reintroduces the argument parsing
    // the vector above exists to avoid.
    if (/\.(cmd|bat|ps1)$/i.test(form.command.trim())) {
      return 'A .cmd, .bat or .ps1 shim cannot be launched directly. Point at the real executable.'
    }
  } else if (form.url.trim() === '') {
    return 'Give the server address.'
  }

  if (form.auth === 'header' && form.authHeader.trim() === '') {
    return 'Name the header the secret goes in.'
  }
  return null
}

/** The form as the harness takes it. Call only once `problemWith` is null. */
export function toDraft(form: ServerForm): McpServerDraft {
  const stdio = form.transport === 'stdio'
  return {
    id: form.id.trim(),
    title: form.title.trim(),
    description: form.description.trim(),
    transport: form.transport,
    auth: form.auth,
    args: stdio ? splitArgs(form.args) : [],
    env: stdio ? parseEnv(form.env) : {},
    needsNetwork: stdio ? form.needsNetwork : true,
    ...(stdio && form.command.trim() !== '' ? { command: form.command.trim() } : {}),
    ...(!stdio && form.url.trim() !== '' ? { url: form.url.trim() } : {}),
    ...(form.auth === 'header' && form.authHeader.trim() !== ''
      ? { authHeader: form.authHeader.trim() }
      : {}),
    ...(stdio && form.authEnvVar.trim() !== '' ? { authEnvVar: form.authEnvVar.trim() } : {}),
  }
}

/**
 * The form as JSON, for the other view.
 *
 * Shaped like the draft the harness takes rather than like the form, so what
 * someone reads here is what is actually sent. A JSON view that showed the
 * form's own fields would be a second vocabulary to learn for no gain.
 */
export function toJson(form: ServerForm): string {
  return `${JSON.stringify(toDraft(form), null, 2)}\n`
}

/**
 * Reads the JSON view back into a form.
 *
 * Tolerant about what is missing and strict about what is present: an absent
 * field falls to the empty form's value, but a field of the wrong shape is a
 * refusal, because silently dropping it would lose an edit the person made.
 */
export function fromJson(text: string): { ok: true; form: ServerForm } | { ok: false; error: string } {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return { ok: false, error: 'That is not valid JSON.' }
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { ok: false, error: 'The top level has to be an object.' }
  }
  const value: Record<string, unknown> = { ...parsed }

  const str = (key: string): string | null => {
    const entry = value[key]
    if (entry === undefined) return ''
    return typeof entry === 'string' ? entry : null
  }

  const id = str('id')
  const title = str('title')
  const description = str('description')
  const command = str('command')
  const url = str('url')
  const authHeader = str('authHeader')
  const authEnvVar = str('authEnvVar')
  if (
    id === null ||
    title === null ||
    description === null ||
    command === null ||
    url === null ||
    authHeader === null ||
    authEnvVar === null
  ) {
    return {
      ok: false,
      error: 'id, title, description, command, url, authHeader and authEnvVar must be text.',
    }
  }

  const transport =
    value['transport'] === undefined
      ? EMPTY_FORM.transport
      : MCP_TRANSPORTS.find((entry) => entry === value['transport'])
  if (transport === undefined) return { ok: false, error: 'transport must be "stdio" or "http".' }

  const auth =
    value['auth'] === undefined
      ? EMPTY_FORM.auth
      : MCP_AUTH_KINDS.find((entry) => entry === value['auth'])
  if (auth === undefined) return { ok: false, error: 'auth must be "none", "bearer" or "header".' }

  const rawArgs = value['args']
  if (rawArgs !== undefined && (!Array.isArray(rawArgs) || rawArgs.some((a) => typeof a !== 'string'))) {
    return { ok: false, error: 'args must be a list of text.' }
  }

  const rawEnv = value['env']
  if (rawEnv !== undefined && (typeof rawEnv !== 'object' || rawEnv === null || Array.isArray(rawEnv))) {
    return { ok: false, error: 'env must be an object of text.' }
  }
  const envEntries = rawEnv === undefined ? [] : Object.entries(rawEnv)
  if (envEntries.some(([, entry]) => typeof entry !== 'string')) {
    return { ok: false, error: 'Every env value must be text.' }
  }

  const needsNetwork = value['needsNetwork']
  if (needsNetwork !== undefined && typeof needsNetwork !== 'boolean') {
    return { ok: false, error: 'needsNetwork must be true or false.' }
  }

  return {
    ok: true,
    form: {
      id,
      title,
      description,
      transport,
      auth,
      command,
      url,
      authHeader,
      authEnvVar,
      args: rawArgs === undefined ? '' : joinArgs(rawArgs as readonly string[]),
      env: envEntries.map(([name, entry]) => `${name}=${String(entry)}`).join('\n'),
      needsNetwork: needsNetwork ?? true,
    },
  }
}
