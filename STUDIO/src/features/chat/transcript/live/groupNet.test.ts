import { describe, expect, it } from 'vitest'

import { present } from '@/platform/harness/contracts/chunks'
import type { ToolCallView } from '@/features/chat/transcript/projection'

import { netOf } from './groupNet'

/**
 * The net of a run, against hand-built calls. The rule it pins: the net is a
 * diff of two provable states of the file -- never the children's sum, and
 * never a guess when the chain of anchors breaks.
 */
describe('netOf', () => {
  function edit(
    id: string,
    oldString: string,
    newString: string,
    errorText: string | null = null,
  ): ToolCallView {
    return {
      toolCallId: id,
      toolName: 'edit',
      input: present({ path: 'f.ts', oldString, newString }),
      output: present('Edited f.ts'),
      errorText,
    }
  }

  function write(id: string, content: string, output = 'Replaced f.ts'): ToolCallView {
    return {
      toolCallId: id,
      toolName: 'write',
      input: present({ path: 'f.ts', content }),
      output: present(output),
      errorText: null,
    }
  }

  it('opens the net at nothing when the harness watched the write create the file', () => {
    // "Created f.ts" is the harness's own proof the file began empty, so the
    // net of the run is the file as its last call left it. The churn counts
    // every line three calls touched; the net counts the file once.
    const run = [
      write('w1', 'a\nb', 'Created f.ts'),
      edit('e1', 'b', 'b\nc'),
      edit('e2', 'c', 'c\nd'),
    ]
    const net = netOf(run)
    expect(net?.added).toBe(4)
    expect(net?.removed).toBe(0)
  })

  it('never nets a write against itself, the zero that says a file changed nothing', () => {
    // The old lie: the write's content taken as both the file as found and
    // as left, +0 -0 for a run that produced a whole file. "Replaced" says
    // there was a file and nothing says what was in it, so there is no net.
    expect(netOf([write('w1', 'a\nb')])).toBeNull()
  })

  it('chains edits alone, the first anchor opening the reconstruction', () => {
    const net = netOf([edit('e1', 'start', 'start\nmid'), edit('e2', 'mid', 'mid\nend')])
    expect(net?.added).toBe(2)
    expect(net?.removed).toBe(0)
  })

  it('refuses the net when an anchor reaches outside everything produced so far', () => {
    // Two edits to distant parts of a file: the second anchor is nowhere in
    // the text the first produced, so no two states are provable.
    expect(netOf([edit('e1', 'one', '1'), edit('e2', 'unrelated', '2')])).toBeNull()
  })

  it('skips a failed call rather than letting it break the chain', () => {
    // The retry pattern: an anchor that failed, then one that worked. The
    // failure changed nothing and contributes nothing.
    const net = netOf([
      edit('e1', 'a', 'a\nb'),
      edit('e2', 'zzz', 'yy', 'anchor not found'),
      edit('e3', 'b', 'b\nc'),
    ])
    expect(net?.added).toBe(2)
    expect(net?.removed).toBe(0)
  })

  it('ends the reconstruction at a whole-file write that lands mid-run', () => {
    // The run opened on an edit's region; the write replaced the whole
    // file, and no two provable states span both.
    expect(
      netOf([
        edit('e1', 'old', 'new'),
        write('w1', 'one\ntwo'),
        edit('e2', 'two', 'two\nthree'),
      ]),
    ).toBeNull()
  })

  it('answers null for a call that carries nothing to reconstruct from', () => {
    const read: ToolCallView = {
      toolCallId: 'r1',
      toolName: 'read',
      input: present({ path: 'f.ts' }),
      output: present('...'),
      errorText: null,
    }
    expect(netOf([read])).toBeNull()
    expect(netOf([edit('e1', '', '')])).toBeNull()
  })
})

describe('netOf on the shapes the wire really carries', () => {
  function call(
    id: string,
    toolName: string,
    input: Record<string, unknown>,
    output = 'Edited f.ts',
  ): ToolCallView {
    return {
      toolCallId: id,
      toolName,
      input: present(input),
      output: present(output),
      errorText: null,
    }
  }

  it('refuses a net for a replaceAll edit', () => {
    // `replaceAll` changes every occurrence in the file. The walk can only
    // see the span it has rebuilt, so occurrences elsewhere are real changes
    // it cannot count -- and a short number wearing the net's name is the one
    // thing this module exists not to print. The header falls back to churn.
    const run = [
      call('w1', 'write', { path: 'f.ts', content: 'x\nx\nx' }, 'Created f.ts'),
      call('e1', 'edit', { path: 'f.ts', oldString: 'x', newString: 'y', replaceAll: true }),
    ]
    expect(netOf(run)).toBeNull()
  })

  it('still nets a single-occurrence edit that says replaceAll is false', () => {
    // The flag is only disqualifying when it is actually set.
    const run = [
      call('w1', 'write', { path: 'f.ts', content: 'a\nb' }, 'Created f.ts'),
      call('e1', 'edit', { path: 'f.ts', oldString: 'b', newString: 'c', replaceAll: false }),
    ]
    const net = netOf(run)
    expect(net).not.toBeNull()
    expect(net?.added).toBe(2)
  })

  it('nets an edit that deletes, where the new string is empty', () => {
    // A deletion carries `newString: ""`. Reading that as a missing field
    // dropped the net for every deletion in the app.
    const run = [
      call('w1', 'write', { path: 'f.ts', content: 'a\nb\n' }, 'Created f.ts'),
      call('e1', 'edit', { path: 'f.ts', oldString: 'b\n', newString: '' }),
    ]
    const net = netOf(run)
    expect(net).not.toBeNull()
    expect(net?.added).toBe(1)
    expect(net?.removed).toBe(0)
  })

  it('nets a write that empties the file', () => {
    const run = [
      call('w1', 'write', { path: 'f.ts', content: 'a\nb' }, 'Created f.ts'),
      call('w2', 'write', { path: 'f.ts', content: '' }, 'Replaced f.ts'),
    ]
    const net = netOf(run)
    expect(net).not.toBeNull()
    expect(net?.added).toBe(0)
    expect(net?.removed).toBe(0)
  })

  it('refuses an edit whose old string is empty', () => {
    // The harness refuses this input outright, and `indexOf("")` answers 0 --
    // which would splice the new text in at the top of the file and call the
    // result a net.
    const run = [
      call('w1', 'write', { path: 'f.ts', content: 'a\nb' }, 'Created f.ts'),
      call('e1', 'edit', { path: 'f.ts', oldString: '', newString: 'c' }),
    ]
    expect(netOf(run)).toBeNull()
  })
})
