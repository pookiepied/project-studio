import { describe, expect, it } from 'vitest'
import {
  parseCommand,
  parseCommandDetail,
  parseCommandExpansion,
  parseCommandListing,
} from './commands'

/**
 * The commands contract. What is pinned: the record the harness actually
 * sends, where the empty string is a value, not an absence. The built-in
 * actions ship `argumentHint` as "" and every prompt command written
 * without a hint arrives as one; read through the non-empty `text` rule
 * they failed the record, one failed record failed the whole listing, and
 * the failed listing was the silent picker and the unread settings pane.
 * The expansion, too: a body that is only `$1`, expanded against no
 * arguments, is answered as the empty prompt, which is an answer.
 */

const COMPACT = {
  id: 'compact',
  description: 'Compact the conversation: fold the earlier turns into a summary',
  argumentHint: '',
  provenance: 'builtin',
  kind: 'action',
  path: null,
} as const

const EXPLAIN = {
  id: 'explain',
  description: 'Explain a file, a function or a concept in plain words',
  argumentHint: '<what to explain>',
  provenance: 'system',
  kind: 'prompt',
  path: 'C:/studio/commands/explain.md',
} as const

const USER = {
  id: 'notes',
  description: 'File a note away',
  argumentHint: '',
  provenance: 'user',
  kind: 'prompt',
  path: 'C:/studio/commands/notes.md',
} as const

const LISTING = {
  commands: [COMPACT, EXPLAIN, USER],
  problems: [{ path: 'C:/studio/commands/WIP.md', reason: 'The file has no prompt under its frontmatter.' }],
  userDirectory: 'C:/studio/commands',
}

describe('parseCommand', () => {
  it('reads the built-in action, whose hint is the empty string and whose path is null', () => {
    expect(parseCommand(COMPACT)).toEqual(COMPACT)
  })

  it('reads a prompt command with its hint, its provenance and its file', () => {
    expect(parseCommand(EXPLAIN)).toEqual(EXPLAIN)
  })

  it('reads a prompt command written without a hint, which arrives as the empty string', () => {
    expect(parseCommand(USER)).toEqual(USER)
  })

  it('refuses a record whose fields are not what they say they are', () => {
    expect(parseCommand({ ...COMPACT, provenance: 'shipped' })).toBeNull()
    expect(parseCommand({ ...COMPACT, kind: 'mystery' })).toBeNull()
    expect(parseCommand({ ...COMPACT, argumentHint: 4 })).toBeNull()
    expect(parseCommand({ ...COMPACT, path: '' })).toBeNull()
    expect(parseCommand({ ...EXPLAIN, path: 7 })).toBeNull()
  })

  it('refuses a record with a field missing, rather than defaulting it', () => {
    const { argumentHint: _hint, ...withoutHint } = EXPLAIN
    expect(parseCommand(withoutHint)).toBeNull()
  })
})

describe('parseCommandListing', () => {
  it('reads the listing: the commands, the problems, and the folder the persons own land in', () => {
    expect(parseCommandListing(LISTING)).toEqual(LISTING)
  })

  it('reads a listing whose built-in is the only command, as a fresh install answers', () => {
    expect(parseCommandListing({ commands: [COMPACT], problems: [], userDirectory: 'C:/studio/commands' })).toEqual({
      commands: [COMPACT],
      problems: [],
      userDirectory: 'C:/studio/commands',
    })
  })

  it('fails the whole listing when one record does not read, because half a picker is a lie', () => {
    expect(parseCommandListing({ ...LISTING, commands: [COMPACT, { ...EXPLAIN, provenance: 'no' }] })).toBeNull()
  })

  it('refuses a listing that is not the envelope', () => {
    expect(parseCommandListing(LISTING.commands)).toBeNull()
    expect(parseCommandListing({ ...LISTING, problems: undefined })).toBeNull()
    expect(parseCommandListing({ ...LISTING, userDirectory: '' })).toBeNull()
    expect(parseCommandListing(null)).toBeNull()
  })
})

describe('parseCommandDetail', () => {
  it('reads an action, which has no file halves to show', () => {
    expect(parseCommandDetail({ command: COMPACT, source: null })).toEqual({ command: COMPACT, source: null })
  })

  it('reads a prompt command with its frontmatter and its body', () => {
    expect(
      parseCommandDetail({
        command: EXPLAIN,
        source: { frontmatter: { description: 'Explain it', argumentHint: '<what>' }, body: 'Explain $ARGUMENTS.' },
      }),
    ).toEqual({
      command: EXPLAIN,
      source: { description: 'Explain it', argumentHint: '<what>', body: 'Explain $ARGUMENTS.' },
    })
  })

  it('reads frontmatter that says nothing as the empty fields, not a refusal', () => {
    const read = parseCommandDetail({ command: USER, source: { frontmatter: {}, body: 'Write it down.' } })
    expect(read).toEqual({
      command: USER,
      source: { description: '', argumentHint: '', body: 'Write it down.' },
    })
  })

  it('reads a detail with no source halves at all as no source, which an unnamed action is', () => {
    expect(parseCommandDetail({ command: COMPACT })).toEqual({ command: COMPACT, source: null })
  })

  it('refuses a detail whose record does not read', () => {
    expect(parseCommandDetail({ command: { ...COMPACT, kind: 'mystery' }, source: null })).toBeNull()
    expect(parseCommandDetail({})).toBeNull()
  })
})

describe('parseCommandExpansion', () => {
  it('reads the prompt the command expands to', () => {
    expect(parseCommandExpansion({ text: 'Review the diff of the login flow.' })).toBe(
      'Review the diff of the login flow.',
    )
  })

  it('reads an expansion of nothing, which a body of only $1 with no arguments answers', () => {
    expect(parseCommandExpansion({ text: '' })).toBe('')
  })

  it('refuses a body whose text is not text', () => {
    expect(parseCommandExpansion({ text: 3 })).toBeNull()
    expect(parseCommandExpansion({})).toBeNull()
    expect(parseCommandExpansion('the prompt')).toBeNull()
  })
})
