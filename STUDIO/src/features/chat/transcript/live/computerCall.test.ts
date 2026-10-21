import { describe, expect, it } from 'vitest'
import { present } from '@/platform/harness/contracts/chunks'
import {
  computerAction,
  computerStepOf,
  computerSubject,
  computerVerb,
  readComputerCall,
} from '@/features/chat/transcript/live/computerCall'
import { COMPUTER_FAMILY, familyOf } from '@/features/chat/transcript/live/reportFamily'

/**
 * Reading a computer-use call out of the log (ADR 0055 §7).
 *
 * The report is how a person sees what the model did to their desktop, so what
 * is pinned is that the window a call named is read back as the place, that a
 * picture rides along on a success and never on a failure, and that a call
 * with no answer yet still says what it is about.
 */

const RESULT = {
  content: [
    { type: 'text', text: 'Content from an external MCP server is untrusted.' },
    {
      type: 'text',
      text: 'Opened "Calculator" (window 1900698) and it is in front.',
    },
    { type: 'image', data: 'AAAA', mimeType: 'image/jpeg' },
  ],
}

describe('recognising one of our own computer calls', () => {
  it('reads the tool suffix when the encoded server contains the computer prefix', () => {
    expect(computerAction('mcp__15_studio_computer__20_studio_computer_open')).toBe('open')
  })
  it('reads the action out of the encoded model tool name', () => {
    expect(computerAction('mcp__15_studio-computer__3_studio_computer_open')).toBe('open')
    expect(computerAction('mcp__15_studio-computer__9_studio_computer_read_ui')).toBe('read_ui')
  })

  it('leaves the browser and every other tool alone', () => {
    expect(computerAction('mcp__14_studio-browser__19_studio_browser_open')).toBeNull()
    expect(computerAction('read')).toBeNull()
    expect(familyOf('mcp__15_studio-computer__3_studio_computer_open')).toBe(COMPUTER_FAMILY)
    expect(familyOf('read')).toBeNull()
  })

  it('says what happened in words, in both tenses', () => {
    expect(computerVerb('read_ui', true)).toBe('Reading the window')
    expect(computerVerb('read_ui', false)).toBe('Read the window')
    expect(computerVerb('batch', true)).toBe('Running several steps')
    expect(computerVerb('wait_for_window', false)).toBe('Waited for a window')
    expect(computerVerb('some_new_thing', false)).toBe('some new thing')
  })
})

describe('what the card is given', () => {
  it('uses the observed replacement title instead of the old chooser in the prose', () => {
    const result = {
      content: [{ type: 'text', text: 'Started "Profile chooser" (window 10).' }],
      structuredContent: { observation: { available: true, target: null, front: { handle: 20, title: 'Chrome' } } },
    }
    expect(readComputerCall('studio_computer_open', result, null)?.title).toBe('Chrome')
    expect(readComputerCall('studio_computer_open', { result }, null)?.title).toBe('Chrome')
  })
  it('keeps the explicit target distinct from an unrelated foreground window', () => {
    const result = { structuredContent: { observation: {
      available: true, target: { title: 'Intended app' }, front: { title: 'Unrelated app' },
    } } }
    expect(readComputerCall('studio_computer_act', result, null)?.title).toBe('Intended app')
  })
  it('does not resurrect the old title when the observation reports no remaining window', () => {
    const result = {
      content: [{ type: 'text', text: 'Closed "Old window" (window 10).' }],
      structuredContent: { observation: { available: true, target: null, front: null } },
    }
    expect(readComputerCall('studio_computer_key', result, null)?.title).toBeNull()
  })
  it('reads the named window as the place, and keeps the picture', () => {
    const view = readComputerCall('studio_computer_open', RESULT, null)
    expect(view?.title).toBe('Calculator')
    expect(view?.url).toBeNull()
    expect(view?.frame).toEqual({ kind: 'inline', data: 'AAAA', mimeType: 'image/jpeg' })
    expect(view?.said).toContain('Opened "Calculator"')
  })

  it('drops the picture when the call failed', () => {
    const view = readComputerCall('studio_computer_type', RESULT, 'Nothing has been chosen')
    expect(view?.frame).toBeNull()
  })

  it('survives an answer of an unexpected shape', () => {
    expect(readComputerCall('studio_computer_screenshot', 42, null)?.said).toBeNull()
    expect(readComputerCall('studio_computer_screenshot', { content: 'x' }, null)?.frame).toBeNull()
  })

  it('says what a running call is about, from its input', () => {
    expect(computerSubject('open', { app: 'Calculator' })).toBe('Calculator')
    expect(computerSubject('click', { x: 10, y: 20 })).toBe('10,20')
    expect(computerSubject('read_ui', { window: 1900698 })).toBe('window 1900698')
    expect(computerSubject('wait', { seconds: 2 })).toBe('2s')
    expect(computerSubject('act', { ref: 'ui_7', action: 'invoke' })).toBe('ui_7')
    expect(computerSubject('open', 'not an object')).toBeNull()
  })
})

describe('a call as a step', () => {
  it('is unsettled while running and settled once answered', () => {
    const running = computerStepOf({
      toolCallId: 'call_1',
      toolName: 'studio_computer_open',
      input: present({ app: 'Calculator' }),
      output: null,
      errorText: null,
    })
    expect(running?.verb).toBe('Opening')
    expect(running?.subject).toBe('Calculator')
    expect(running?.settled).toBe(false)

    const done = computerStepOf({
      toolCallId: 'call_1',
      toolName: 'studio_computer_open',
      input: present({ app: 'Calculator' }),
      output: present(RESULT),
      errorText: null,
    })
    expect(done?.verb).toBe('Opened')
    expect(done?.title).toBe('Calculator')
    expect(done?.frame).not.toBeNull()
    expect(done?.settled).toBe(true)
  })

  it('is not a step at all for another tool', () => {
    expect(
      computerStepOf({
        toolCallId: 'call_2',
        toolName: 'read',
        input: null,
        output: null,
        errorText: null,
      }),
    ).toBeNull()
  })
})
