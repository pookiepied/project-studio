import {
  MCP_AUTH_KINDS,
  MCP_TRANSPORTS,
  type McpAuthKind,
  type McpServerDraft,
  type McpServerRecord,
  type McpTransport,
} from '@/platform/harness'

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
  readonly transport: McpTransport
  readonly command: string
  /** Space separated, quotes respected. See `splitArgs`. */
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
 * Splits an argument line into a vector.
 *
 * Quotes are respected because paths have spaces in them and a Windows user
 * typing `"C:\Program Files\node\node.exe"` means one argument. This is the
 * ONLY place a string becomes a vector: the harness stores the vector and
 * never re-splits it, and no shell is ever involved, so a metacharacter in an
 * argument is a character rather than syntax.
 */
export function splitArgs(line: string): readonly string[] {
  const out: string[] = []
  let current = ''
  let quote: '"' | "'" | null = null
  let started = false

  for (const character of line) {
    if (quote !== null) {
      if (character === quote) quote = null
      else current += character
      continue
    }
    if (character === '"' || character === "'") {
      quote = character
      started = true
      continue
    }
    if (character === ' ' || character === '\t' || character === '\n') {
      if (started) out.push(current)
      current = ''
      started = false
      continue
    }
    current += character
    started = true
  }
  if (started) out.push(current)
  return out
}

/**
 * The inverse, for showing a stored vector in one line.
 *
 * An EMPTY argument is quoted too, and that is not a nicety: written bare it
 * becomes a run of spaces, which `splitArgs` discards, so an argument the
 * server was configured with would disappear the moment someone opened the
 * edit dialog and saved it again.
 */
export function joinArgs(args: readonly string[]): string {
  return args
    .map((arg) => (arg === '' || /[\s"']/.test(arg) ? `"${arg}"` : arg))
    .join(' ')
}

/**
 * Reads `NAME=value` lines.
 *
 * Everything after the first `=` is the value, so a variable holding a URL or
 * a base64 blob survives. Blank lines and lines with no `=` are skipped rather
 * than refused: someone mid-edit should not be shown an error for a line they
 * have not finished typing.
 */
export function parseEnv(text: string): Readonly<Record<string, string>> {
  const out: Record<string, string> = {}
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (trimmed === '' || trimmed.startsWith('#')) continue
    const at = trimmed.indexOf('=')
    if (at <= 0) continue
    out[trimmed.slice(0, at).trim()] = trimmed.slice(at + 1)
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
  const command = str('command')
  const url = str('url')
  const authHeader = str('authHeader')
  const authEnvVar = str('authEnvVar')
  if (
    id === null ||
    title === null ||
    command === null ||
    url === null ||
    authHeader === null ||
    authEnvVar === null
  ) {
    return { ok: false, error: 'id, title, command, url, authHeader and authEnvVar must be text.' }
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
