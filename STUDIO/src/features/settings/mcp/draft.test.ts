import { describe, expect, it } from 'vitest'
import {
  EMPTY_FORM,
  formFrom,
  fromJson,
  joinArgs,
  parseEnv,
  problemWith,
  splitArgs,
  toDraft,
  toJson,
  type ServerForm,
} from '@/features/settings/mcp/draft'
import type { McpServerRecord } from '@/platform/harness'

const STDIO: ServerForm = {
  ...EMPTY_FORM,
  id: 'memory',
  title: 'Memory',
  transport: 'stdio',
  command: 'C:\\Program Files\\nodejs\\node.exe',
  args: '-y\n@modelcontextprotocol/server-memory',
}

describe('argument splitting', () => {
  it('reads one argument per line', () => {
    expect(splitArgs('-y\n@modelcontextprotocol/server-memory')).toEqual([
      '-y',
      '@modelcontextprotocol/server-memory',
    ])
  })

  it('keeps a path with spaces in one piece, unquoted', () => {
    // The case the whole change exists for. Written on a line of its own, a
    // Windows path needs no quoting and cannot be mis-split - which is what
    // sent a real server the two halves of "C:\Program Files" as two
    // arguments and made it look broken.
    expect(
      splitArgs('--root\nD:\\My Projects\\site\n--verbose'),
    ).toEqual(['--root', 'D:\\My Projects\\site', '--verbose'])
  })

  it('treats a metacharacter as a character', () => {
    // No shell is ever involved, so these are text rather than syntax.
    expect(splitArgs('--filter\na&&b\n--path\n$HOME')).toEqual([
      '--filter',
      'a&&b',
      '--path',
      '$HOME',
    ])
  })

  it('keeps an empty argument, and one that is deliberately padded', () => {
    expect(splitArgs('--prefix\n""\n--x')).toEqual(['--prefix', '', '--x'])
    expect(splitArgs('" pad "')).toEqual([' pad '])
  })

  it('ignores blank lines and trims a pasted line', () => {
    expect(splitArgs('\n  -a  \n\n -b \n')).toEqual(['-a', '-b'])
    expect(splitArgs('')).toEqual([])
  })

  it('survives a round trip through the field it is shown in', () => {
    const args = ['--root', 'D:\\My Projects\\site', '-y', '', ' padded ']
    expect(splitArgs(joinArgs(args))).toEqual(args)
  })
})

describe('environment lines', () => {
  it('reads NAME=value', () => {
    expect(parseEnv('ROOT=D:\\projects\nLOG_LEVEL=info')).toEqual({
      ROOT: 'D:\\projects',
      LOG_LEVEL: 'info',
    })
  })

  it('keeps everything after the first equals', () => {
    // A variable holding a URL or a base64 blob has to survive intact.
    expect(parseEnv('URL=https://example.com/a?b=c&d=e')).toEqual({
      URL: 'https://example.com/a?b=c&d=e',
    })
  })

  it('skips blanks, comments and half-typed lines', () => {
    // Someone mid-edit should not be shown an error for a line in progress.
    expect(parseEnv('\n# a note\nHALF\n=novalue\nGOOD=1\n')).toEqual({ GOOD: '1' })
  })
})

describe('what is wrong with the form', () => {
  it('says the first thing only', () => {
    expect(problemWith(EMPTY_FORM)).toBe('Give the server an id.')
    expect(problemWith({ ...EMPTY_FORM, id: 'memory' })).toBe('Give the server a name.')
  })

  it('refuses an id that cannot be a namespace', () => {
    expect(problemWith({ ...EMPTY_FORM, id: 'my server' })).toContain('may hold only')
  })

  it('refuses a Windows shim, which the harness would refuse anyway', () => {
    const shim = { ...STDIO, command: 'C:\\npm\\npx.cmd' }
    expect(problemWith(shim)).toContain('.cmd, .bat or .ps1')
  })

  it('asks for an address on http and a command on stdio', () => {
    expect(problemWith({ ...EMPTY_FORM, id: 'a', title: 'A', transport: 'stdio' })).toContain(
      'command',
    )
    expect(problemWith({ ...EMPTY_FORM, id: 'a', title: 'A', transport: 'http' })).toContain(
      'address',
    )
  })

  it('asks for a header name only when the header kind is chosen', () => {
    const base = { ...STDIO, auth: 'header' } as const
    expect(problemWith(base)).toContain('header')
    expect(problemWith({ ...base, authHeader: 'X-Api-Key' })).toBeNull()
    expect(problemWith({ ...STDIO, auth: 'bearer' })).toBeNull()
  })

  it('is happy with a complete form', () => {
    expect(problemWith(STDIO)).toBeNull()
  })
})

describe('the draft that is actually sent', () => {
  it('carries the stdio fields and drops the http ones', () => {
    const draft = toDraft({ ...STDIO, url: 'https://leftover.example' })
    expect(draft).toMatchObject({
      id: 'memory',
      transport: 'stdio',
      command: 'C:\\Program Files\\nodejs\\node.exe',
      args: ['-y', '@modelcontextprotocol/server-memory'],
    })
    expect('url' in draft).toBe(false)
  })

  it('carries the http fields and drops the stdio ones', () => {
    const draft = toDraft({
      ...EMPTY_FORM,
      id: 'remote',
      title: 'Remote',
      transport: 'http',
      url: 'https://example.com/mcp',
      command: 'leftover',
      args: '--leftover',
      env: 'LEFT=over',
    })
    expect(draft).toMatchObject({ url: 'https://example.com/mcp', args: [], env: {} })
    expect('command' in draft).toBe(false)
  })

  it('never carries a secret, whatever the auth kind', () => {
    // The whole reason the JSON view is safe to show: there is no field here
    // for a secret to live in.
    const draft = toDraft({ ...STDIO, auth: 'bearer', authEnvVar: 'API_KEY' })
    expect(JSON.stringify(draft)).not.toContain('secret')
    expect(draft).toMatchObject({ auth: 'bearer', authEnvVar: 'API_KEY' })
  })
})

describe('the JSON view', () => {
  it('round trips a form without losing anything', () => {
    const parsed = fromJson(toJson(STDIO))
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    // Compared as drafts, since the form holds text and the draft holds the
    // parsed shapes - a round trip has to preserve the meaning, not the
    // spacing someone typed.
    expect(toDraft(parsed.form)).toEqual(toDraft(STDIO))
  })

  it('refuses text that is not JSON, rather than discarding the edit', () => {
    expect(fromJson('{not json')).toEqual({ ok: false, error: 'That is not valid JSON.' })
  })

  it('refuses a top level that is not an object', () => {
    expect(fromJson('[]').ok).toBe(false)
    expect(fromJson('"a string"').ok).toBe(false)
  })

  it('refuses a field of the wrong shape rather than dropping it', () => {
    expect(fromJson('{"id":42}').ok).toBe(false)
    expect(fromJson('{"transport":"sse"}').ok).toBe(false)
    expect(fromJson('{"auth":"oauth"}').ok).toBe(false)
    expect(fromJson('{"args":"one two"}').ok).toBe(false)
    expect(fromJson('{"env":{"A":1}}').ok).toBe(false)
    expect(fromJson('{"needsNetwork":"yes"}').ok).toBe(false)
  })

  it('accepts a configuration pasted with only the fields a README shows', () => {
    // How MCP servers are actually distributed: a command and its args.
    const parsed = fromJson(
      '{"id":"memory","title":"Memory","command":"node","args":["-y","server-memory"]}',
    )
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.form.transport).toBe('stdio')
    expect(parsed.form.auth).toBe('none')
    expect(splitArgs(parsed.form.args)).toEqual(['-y', 'server-memory'])
  })
})

describe('editing an installed server', () => {
  it('fills the form from the record', () => {
    const record: McpServerRecord = {
      id: 'memory',
      title: 'Memory',
      description: 'Remembers things between conversations.',
      provenance: 'user',
      transport: 'stdio',
      command: 'node',
      args: ['-y', 'server-memory'],
      env: { LOG: 'info' },
      auth: 'none',
      needsNetwork: false,
      enabledByDefault: true,
    }
    const form = formFrom(record)
    expect(form).toMatchObject({
      id: 'memory',
      // The sentence the model is given, carried through the dialog. It is a
      // separate field from the name on purpose: the name is what a person
      // scans the list for, and this is what decides whether a run reaches
      // for the server at all.
      description: 'Remembers things between conversations.',
      command: 'node',
      args: '-y\nserver-memory',
      env: 'LOG=info',
      needsNetwork: false,
    })
    // And back again unchanged, so opening an edit and saving it is a no-op.
    expect(toDraft(form)).toMatchObject({
      id: 'memory',
      description: 'Remembers things between conversations.',
      args: ['-y', 'server-memory'],
      env: { LOG: 'info' },
      needsNetwork: false,
    })
  })
})
