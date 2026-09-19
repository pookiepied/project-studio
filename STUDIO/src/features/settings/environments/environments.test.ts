/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from 'vitest'
import {
  parseSandboxScopeInfo,
  parseSandboxScopeRow,
} from '@/platform/harness'

describe('parseSandboxScopeRow', () => {
  const ROW = {
    projectId: 'prj_a',
    path: 'C:\\Users\\ada\\.cargo',
    mode: 'write',
    source: 'question',
    presetId: null,
    grantedAt: 1_000,
  }

  it('accepts a question grant with no preset', () => {
    expect(parseSandboxScopeRow(ROW)?.source).toBe('question')
  })

  it('accepts a preset grant naming its preset', () => {
    const parsed = parseSandboxScopeRow({ ...ROW, source: 'preset', presetId: 'rust' })
    expect(parsed?.presetId).toBe('rust')
  })

  it('refuses a mode outside read and write', () => {
    expect(parseSandboxScopeRow({ ...ROW, mode: 'execute' })).toBeNull()
  })

  it('refuses a source outside the three', () => {
    expect(parseSandboxScopeRow({ ...ROW, source: 'dialog' })).toBeNull()
  })
})

describe('parseSandboxScopeInfo', () => {
  it('accepts project rows beside machine-wide rows, a level, and folder trust', () => {
    const parsed = parseSandboxScopeInfo({
      project: [],
      machineWide: [],
      level: 'contained',
      trust: [{ root: 'C:\\Work\\alpha', name: 'alpha', decision: 'undecided' }],
    })
    expect(parsed?.level).toBe('contained')
    expect(parsed?.trust[0]?.decision).toBe('undecided')
  })

  it('refuses a level outside contained and trusted', () => {
    expect(
      parseSandboxScopeInfo({ project: [], machineWide: [], level: 'docker', trust: [] }),
    ).toBeNull()
  })

  it('refuses a body with no trust list at all', () => {
    // A level and a folder decision are different answers with a colliding
    // word, and a body missing the second must not be read as "no folders
    // are trusted" - which is the reading that would quietly hide the
    // section that explains why a project can only read.
    expect(
      parseSandboxScopeInfo({ project: [], machineWide: [], level: 'contained' }),
    ).toBeNull()
  })

  it('refuses a decision outside the three the harness can answer', () => {
    expect(
      parseSandboxScopeInfo({
        project: [],
        machineWide: [],
        level: 'contained',
        trust: [{ root: 'C:\\Work\\alpha', name: 'alpha', decision: 'maybe' }],
      }),
    ).toBeNull()
  })
})
