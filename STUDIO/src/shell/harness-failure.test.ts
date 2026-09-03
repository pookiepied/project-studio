import { describe, expect, it } from 'vitest'

import { classifyHarnessFailure, describeHarnessFailure } from '@/shell/harness-failure'

/**
 * The classifier is only as honest as its anchors, so the sentences below are
 * copied verbatim out of `src-tauri/src/harness/supervisor.rs` rather than
 * paraphrased into something convenient. A test that invents its own wording
 * would pass forever while the real message drifted out from under it, which is
 * exactly the failure this file exists to catch.
 */
const REAL: Readonly<Record<string, string>> = {
  notInstalled:
    'Harness server not found. Run `pnpm build` in `STUDIO HARNESS/` and ensure dist/server.mjs exists.',
  nodeMissing:
    'failed to spawn node harness: program not found (path=D:\\Studio\\STUDIO HARNESS\\dist\\server.mjs)',
  exited:
    'Harness exited before readiness (status=exit code: 1). stderr=StorageError: this build supports 17.',
  streamClosed: 'Harness readiness stream closed without a frame. stderr=(nothing)',
  timedOut: 'Harness did not publish loopback readiness within 30000ms. observed=(nothing)',
  malformed: 'Harness readiness malformed: {"port":0}. stderr=(nothing)',
  invalidFrame: 'invalid readiness frame',
  wrongHost: 'harness readiness host must be 127.0.0.1, got 0.0.0.0',
  jobObject: 'failed to assign harness to job object: Access is denied. (os error 5)',
  inFlight: 'a harness start is in flight and did not settle',
}

describe('classifying what the supervisor said', () => {
  it('reads each sentence the supervisor can actually produce', () => {
    expect(classifyHarnessFailure(REAL['notInstalled'] ?? '')).toBe('not-installed')
    expect(classifyHarnessFailure(REAL['nodeMissing'] ?? '')).toBe('node-missing')
    expect(classifyHarnessFailure(REAL['exited'] ?? '')).toBe('crashed')
    expect(classifyHarnessFailure(REAL['streamClosed'] ?? '')).toBe('crashed')
    expect(classifyHarnessFailure(REAL['timedOut'] ?? '')).toBe('timed-out')
    expect(classifyHarnessFailure(REAL['malformed'] ?? '')).toBe('bad-handshake')
    expect(classifyHarnessFailure(REAL['invalidFrame'] ?? '')).toBe('bad-handshake')
    expect(classifyHarnessFailure(REAL['wrongHost'] ?? '')).toBe('bad-handshake')
    expect(classifyHarnessFailure(REAL['jobObject'] ?? '')).toBe('blocked')
    expect(classifyHarnessFailure(REAL['inFlight'] ?? '')).toBe('busy')
  })

  it('calls an absent or empty sentence unknown rather than guessing', () => {
    expect(classifyHarnessFailure(null)).toBe('unknown')
    expect(classifyHarnessFailure('')).toBe('unknown')
    expect(classifyHarnessFailure('   ')).toBe('unknown')
  })

  it('falls back to unknown for a sentence it does not recognise', () => {
    // The safe direction. A reworded message in supervisor.rs lands here and
    // shows its own words; it must never be filed under a cause it is not.
    expect(classifyHarnessFailure('something nobody has written yet')).toBe('unknown')
  })
})

describe('what the person reads', () => {
  it('never puts a build command or a repository path in front of a user', () => {
    // The whole point. `pnpm build` and `dist/server.mjs` are instructions for
    // whoever holds the repository, and this page is not for them.
    const copy = describeHarnessFailure(REAL['notInstalled'] ?? '')
    expect(copy.headline).not.toContain('pnpm')
    expect(copy.headline).not.toContain('dist/server.mjs')
    expect(copy.remedy).not.toContain('pnpm')
    expect(copy.remedy).not.toContain('dist/server.mjs')
    // It names the path instead of only saying "reinstall", because the same
    // message is what a development tree produces before the harness is built,
    // and that reader cannot act on reinstall advice.
    expect(copy.remedy).toContain('path that was searched')
  })

  it('gives every recognised kind a remedy, and unknown none', () => {
    for (const sentence of Object.values(REAL)) {
      const copy = describeHarnessFailure(sentence)
      expect(copy.kind).not.toBe('unknown')
      expect(copy.remedy).not.toBeNull()
    }
    // Nothing true can be said about a cause nobody identified, so nothing is.
    const unknown = describeHarnessFailure('a sentence from the future')
    expect(unknown.kind).toBe('unknown')
    expect(unknown.remedy).toBeNull()
    expect(unknown.headline).toBe('The harness is not running.')
    expect(unknown.code).toBe('HARNESS_UNKNOWN')
  })

  it('gives every kind its own code', () => {
    // One code per KIND, not per sentence: several supervisor messages map to
    // the same kind on purpose (an exit and a closed stream are both a crash).
    // What must not happen is two different kinds answering with one code,
    // which would make a quoted code ambiguous at exactly the wrong moment.
    const byKind = new Map<string, string>()
    for (const sentence of [...Object.values(REAL), null]) {
      const { kind, code } = describeHarnessFailure(sentence)
      expect(code).toMatch(/^HARNESS_[A-Z_]+$/)
      const seen = byKind.get(kind)
      if (seen !== undefined) expect(code).toBe(seen)
      byKind.set(kind, code)
    }
    const codes = [...byKind.values()]
    expect(new Set(codes).size).toBe(codes.length)
  })

  it('states the failure plainly, without flourish', () => {
    // House style for error copy: say what happened and what to do. These
    // were written as prose and read as prose, which is the wrong register
    // for a line someone hits when their app will not start.
    for (const sentence of Object.values(REAL)) {
      const { headline, remedy } = describeHarnessFailure(sentence)
      expect(headline.endsWith('.')).toBe(true)
      expect(remedy).not.toBeNull()
      // No second-person storytelling and no metaphor about the machinery.
      expect(remedy).not.toMatch(/worth sending on|the part worth|began and then/)
    }
  })

  it('keeps every headline short enough for the display serif', () => {
    for (const sentence of [...Object.values(REAL), null]) {
      expect(describeHarnessFailure(sentence).headline.length).toBeLessThanOrEqual(48)
    }
  })
})
