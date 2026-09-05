/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from 'vitest'
import {
  parseDetectedPresets,
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
  it('accepts project rows beside machine-wide rows and a level', () => {
    const parsed = parseSandboxScopeInfo({
      project: [],
      machineWide: [],
      level: 'contained',
    })
    expect(parsed?.level).toBe('contained')
  })

  it('refuses a level outside contained and trusted', () => {
    expect(
      parseSandboxScopeInfo({ project: [], machineWide: [], level: 'docker' }),
    ).toBeNull()
  })
})

describe('parseDetectedPresets', () => {
  it('accepts a detected Git preset with the path found', () => {
    const parsed = parseDetectedPresets([
      {
        id: 'git',
        title: 'Git',
        description: 'The Git installation.',
        paths: [{ path: 'C:\\Program Files\\Git', mode: 'read' }],
      },
    ])
    expect(parsed?.[0]?.id).toBe('git')
  })

  it('refuses a preset with no paths field', () => {
    expect(
      parseDetectedPresets([{ id: 'git', title: 'Git', description: 'x' }]),
    ).toBeNull()
  })
})
