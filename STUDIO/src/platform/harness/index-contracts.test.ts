import { describe, expect, it } from 'vitest'

import {
  parseConversationRecord,
  parseConversationRecords,
  parseProjectRecord,
  parsePurgeOutcome,
} from './contracts'

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
  permissionMode: 'manual',
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
    expect(parseConversationRecord({ ...CONVERSATION, permissionMode: 'auto-edit' })?.permissionMode).toBe('auto-edit')
    expect(parseConversationRecord({ ...CONVERSATION, permissionMode: 'full-auto' })?.permissionMode).toBe('full-auto')
    // The picker's own spellings are a different vocabulary on purpose; a
    // value the submission boundary would refuse cannot arrive on a record.
    expect(parseConversationRecord({ ...CONVERSATION, permissionMode: 'edits' })).toBeNull()
    expect(parseConversationRecord({ ...CONVERSATION, permissionMode: 'auto' })).toBeNull()
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
  it('accepts removed ids with no cleanup failures', () => {
    expect(parsePurgeOutcome({ removed: ['cnv_1'], cleanupFailures: {} })).toEqual({
      removed: ['cnv_1'],
      cleanupFailures: {},
    })
  })

  it('carries a partial cleanup through as data, not as an error', () => {
    const parsed = parsePurgeOutcome({
      removed: ['cnv_locked'],
      cleanupFailures: { cnv_locked: 'a file was still open' },
    })
    expect(parsed?.cleanupFailures['cnv_locked']).toContain('still open')
  })

  it('refuses a failure message that is not text', () => {
    expect(parsePurgeOutcome({ removed: [], cleanupFailures: { cnv_x: 7 } })).toBeNull()
  })
})
