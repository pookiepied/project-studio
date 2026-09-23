import { describe, expect, it } from 'vitest'
import type { CommandRecord } from '@/platform/harness'
import { matchingCommands, readSlash, slashQuery } from './slash'

const command = (id: string): CommandRecord => ({
  id,
  description: id,
  argumentHint: '',
  provenance: 'user',
  kind: 'prompt',
  path: null,
})

// Listed deliberately out of alphabetical order: re-explain before explain,
// so the expectations below can tell the harness's order from the match's.
const COMMANDS = [command('compact'), command('review'), command('re-explain'), command('explain')]

describe('readSlash', () => {
  it('reads a known name and what follows it', () => {
    expect(readSlash('/review the tests', COMMANDS)).toEqual({
      command: COMMANDS[1],
      args: 'the tests',
    })
    expect(readSlash('/compact', COMMANDS)?.args).toBe('')
    expect(readSlash('  /Review  ', COMMANDS)?.command.id).toBe('review')
  })

  it('leaves words alone: a path, an unknown name, a space after the slash', () => {
    expect(readSlash('/usr/bin/env', COMMANDS)).toBeNull()
    expect(readSlash('/nothing here', COMMANDS)).toBeNull()
    expect(readSlash('/ hello', COMMANDS)).toBeNull()
    expect(readSlash('review', COMMANDS)).toBeNull()
  })
})

describe('slashQuery', () => {
  it('is the name while it is being typed, and nothing once it is finished', () => {
    expect(slashQuery('/')).toBe('')
    expect(slashQuery('/re')).toBe('re')
    expect(slashQuery('/review ')).toBeNull()
    expect(slashQuery('hello /re')).toBeNull()
  })
})

describe('matchingCommands', () => {
  it('offers everything for an empty query, prefixes first otherwise', () => {
    expect(matchingCommands('', COMMANDS)).toEqual(COMMANDS)
    expect(matchingCommands('re', COMMANDS).map((entry) => entry.id)).toEqual([
      'review',
      're-explain',
    ])
    // `explain` is listed after `re-explain`, yet comes first: what starts
    // with the query outranks what merely contains it.
    expect(matchingCommands('expl', COMMANDS).map((entry) => entry.id)).toEqual([
      'explain',
      're-explain',
    ])
  })

  it('keeps the order the harness listed, among the names that merely contain the query', () => {
    expect(matchingCommands('xpl', COMMANDS).map((entry) => entry.id)).toEqual([
      're-explain',
      'explain',
    ])
  })
})
