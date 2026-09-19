import { describe, expect, it } from 'vitest'

import {
  parseConversationRecord,
  parseConversationRecords,
  parseProjectRecord,
  parsePurgeOutcome,
  parseOrphanSweepOutcome,
  parseOrphanTrees,
} from './index'

/**
 * The conversation-index parsers, on their own.
 *
 * The same discipline as `contracts.test.ts`: every case is a body the
 * harness could plausibly send after a contract change, plus the ones a
 * confused peer could send deliberately. The one thing these parsers must
 * never do is let a transcript-shaped field ride along - an index record is
 * identity, not content.
 */

const CONVERSATION = {
  id: 'cnv_1',
  title: 'A stored conversation',
  projectId: null,
  titleManual: false,
  pinned: false,
  archived: false,
  modelId: null,
  reasoningLevel: null,
  permissionMode: 'ask',
  createdAt: 1_000,
  lastTurnAt: 2_000,
} as const

describe('parseConversationRecord', () => {
  it('accepts the stored shape', () => {
    expect(parseConversationRecord(CONVERSATION)).toEqual(CONVERSATION)
  })

  it('rejects a transcript field riding along', () => {
    // If the harness ever starts sending text here, this parser must refuse
    // until the contract says to carry it. An accidental second source of
    // transcript is the failure Part 0 exists to prevent.
    const parsed = parseConversationRecord({
      ...CONVERSATION,
      messages: [{ role: 'user', text: 'smuggled' }],
    })
    expect(parsed).toEqual(CONVERSATION)
    expect(parsed).not.toHaveProperty('messages')
  })

  it('refuses a flag that arrived as something else', () => {
    expect(parseConversationRecord({ ...CONVERSATION, archived: 'yes' })).toBeNull()
    expect(parseConversationRecord({ ...CONVERSATION, titleManual: 1 })).toBeNull()
  })

  it('refuses a recency stamp that is not a number', () => {
    expect(parseConversationRecord({ ...CONVERSATION, lastTurnAt: 'now' })).toBeNull()
  })

  it('keeps null fields null instead of inventing defaults', () => {
    expect(parseConversationRecord({ ...CONVERSATION, title: null })?.title).toBeNull()
    expect(parseConversationRecord({ ...CONVERSATION, modelId: null })?.modelId).toBeNull()
    expect(
      parseConversationRecord({ ...CONVERSATION, reasoningLevel: null })?.reasoningLevel,
    ).toBeNull()
  })

  it('accepts a settled reasoning choice and refuses a level it does not know', () => {
    expect(
      parseConversationRecord({ ...CONVERSATION, reasoningLevel: 'default' })?.reasoningLevel,
    ).toBe('default')
    expect(
      parseConversationRecord({ ...CONVERSATION, reasoningLevel: 'xhigh' })?.reasoningLevel,
    ).toBe('xhigh')
    expect(
      parseConversationRecord({ ...CONVERSATION, reasoningLevel: 'colossal' }),
    ).toBeNull()
  })

  it('requires the mode the store never hands back as null', () => {
    // The harness resolves an unset row to Manual before the record leaves,
    // so a missing field here is drift, not an old row - refusing it is the
    // visible failure the mirror is designed to produce.
    const { permissionMode: _mode, ...without } = CONVERSATION
    expect(parseConversationRecord(without)).toBeNull()
  })

  it('carries the mode in the harness vocabulary only', () => {
    expect(parseConversationRecord({ ...CONVERSATION, permissionMode: 'ask' })?.permissionMode).toBe('ask')
    expect(parseConversationRecord({ ...CONVERSATION, permissionMode: 'auto' })?.permissionMode).toBe('auto')
    // The three retired names are refused, not translated: a value the
    // submission boundary would refuse cannot arrive on a record.
    expect(parseConversationRecord({ ...CONVERSATION, permissionMode: 'manual' })).toBeNull()
    expect(parseConversationRecord({ ...CONVERSATION, permissionMode: 'auto-edit' })).toBeNull()
    expect(parseConversationRecord({ ...CONVERSATION, permissionMode: 'full-auto' })).toBeNull()
    expect(parseConversationRecord({ ...CONVERSATION, permissionMode: null })).toBeNull()
  })

  it('fails the whole list when one element does not match', () => {
    const parsed = parseConversationRecords([CONVERSATION, { id: 4 }])
    expect(parsed).toBeNull()
  })
})

describe('parseProjectRecord', () => {
  const PROJECT = {
    id: 'prj_x',
    name: 'Quiet Hours',
    icon: 'arc',
    description: '',
    folders: [{ id: 'fold_1', name: 'quiet-hours', path: 'D:/Work/quiet-hours' }],
    createdAt: 3_000,
  }

  it('accepts folders in their stored order', () => {
    const parsed = parseProjectRecord(PROJECT)
    expect(parsed?.folders).toHaveLength(1)
    expect(parsed?.folders[0]?.path).toBe('D:/Work/quiet-hours')
  })

  it('accepts the empty description that no description means', () => {
    const parsed = parseProjectRecord({ ...PROJECT, description: '' })
    expect(parsed?.description).toBe('')
  })

  it('refuses a description that arrived as null or something else', () => {
    // The column is NOT NULL at the other end; empty is its "none".
    expect(parseProjectRecord({ ...PROJECT, description: null })).toBeNull()
    expect(parseProjectRecord({ ...PROJECT, description: undefined })).toBeNull()
  })

  it('refuses a mark that is not one of the eight', () => {
    expect(parseProjectRecord({ ...PROJECT, icon: 'flame' })).toBeNull()
  })

  it('refuses a folder whose path is missing', () => {
    expect(
      parseProjectRecord({
        ...PROJECT,
        folders: [{ id: 'fold_1', name: 'quiet-hours' }],
      }),
    ).toBeNull()
  })
})

describe('parsePurgeOutcome', () => {
  const DETAIL = { indexRow: true, tree: true, journal: true, scoped: true }

  it('accepts removed ids with no cleanup failures', () => {
    expect(
      parsePurgeOutcome({ removed: ['cnv_1'], cleanupFailures: {}, details: { cnv_1: DETAIL } }),
    ).toEqual({
      removed: ['cnv_1'],
      cleanupFailures: {},
      details: { cnv_1: DETAIL },
    })
  })

  it('carries a partial cleanup through as data, not as an error', () => {
    const parsed = parsePurgeOutcome({
      removed: [],
      cleanupFailures: { cnv_locked: 'a file was still open' },
      details: {
        cnv_locked: {
          indexRow: true,
          tree: false,
          journal: true,
          scoped: true,
          error: 'a file was still open',
        },
      },
    })
    expect(parsed?.cleanupFailures['cnv_locked']).toContain('still open')
    expect(parsed?.details['cnv_locked']).toMatchObject({ tree: false, indexRow: true })
  })

  it('carries a running refusal with its code', () => {
    const parsed = parsePurgeOutcome({
      removed: [],
      cleanupFailures: { cnv_live: 'Conversation "cnv_live" has a turn in flight' },
      details: {
        cnv_live: {
          indexRow: false,
          tree: false,
          journal: false,
          scoped: false,
          errorCode: 'storage.conflict',
          error: 'Conversation "cnv_live" has a turn in flight',
        },
      },
    })
    expect(parsed?.details['cnv_live']?.errorCode).toBe('storage.conflict')
  })

  it('refuses a failure message that is not text', () => {
    expect(
      parsePurgeOutcome({ removed: [], cleanupFailures: { cnv_x: 7 }, details: {} }),
    ).toBeNull()
  })

  it('refuses a detail that does not say what happened', () => {
    expect(
      parsePurgeOutcome({
        removed: [],
        cleanupFailures: {},
        details: { cnv_x: { indexRow: true } },
      }),
    ).toBeNull()
  })
})

describe('parseOrphanTrees', () => {
  it('accepts a list of orphaned directory names', () => {
    expect(parseOrphanTrees({ orphans: ['agent', 'cnv_1j04nco6'] })).toEqual({
      orphans: ['agent', 'cnv_1j04nco6'],
    })
  })

  it('refuses names that are not text', () => {
    expect(parseOrphanTrees({ orphans: [7] })).toBeNull()
  })
})

describe('parseOrphanSweepOutcome', () => {
  it('accepts removed names with failures as data', () => {
    expect(
      parseOrphanSweepOutcome({ removed: ['agent'], failures: { beta: 'a file was still open' } }),
    ).toEqual({ removed: ['agent'], failures: { beta: 'a file was still open' } })
  })

  it('refuses a failure message that is not text', () => {
    expect(parseOrphanSweepOutcome({ removed: [], failures: { beta: 7 } })).toBeNull()
  })
})
