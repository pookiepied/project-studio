import { describe, expect, it } from 'vitest'
import { EchoGuard, isOwnEcho } from './echo'

const SPOKEN =
  'Sure. The build failed because the lockfile is out of date. Run pnpm install, ' +
  'then commit the updated lockfile and push again. That should clear the check.'

describe('isOwnEcho', () => {
  it('recognises the reply coming back, with the slips a transcriber makes', () => {
    expect(isOwnEcho('then commit the updated lock file and push again', SPOKEN)).toBe(true)
    expect(isOwnEcho('The build failed because the lockfile is out of date.', SPOKEN)).toBe(true)
    // Punctuation, case and accents do not matter.
    expect(isOwnEcho('THAT SHOULD CLEAR THE CHECK', SPOKEN)).toBe(true)
    // A short tail of what was just said.
    expect(isOwnEcho('the check', SPOKEN)).toBe(true)
  })

  it('never takes the person for an echo', () => {
    // Something new.
    expect(isOwnEcho('what about the docker image instead', SPOKEN)).toBe(false)
    // An interruption, even one that reuses the reply's words.
    expect(isOwnEcho('wait, push again?', SPOKEN)).toBe(false)
    expect(isOwnEcho('no', 'No, that is not it.')).toBe(false)
    expect(isOwnEcho('stop', 'Run it, then stop the server.')).toBe(false)
    // A question built around a phrase from the reply is mostly new words.
    expect(isOwnEcho('why is the lockfile out of date on my laptop though', SPOKEN)).toBe(false)
    // A short take that only appeared long ago in the reply.
    expect(isOwnEcho('sure', SPOKEN)).toBe(false)
    // Words in the reply, but not in the order it said them.
    expect(isOwnEcho('push the check, clear the lockfile', SPOKEN)).toBe(false)
  })

  it('needs something heard and something said', () => {
    expect(isOwnEcho('', SPOKEN)).toBe(false)
    expect(isOwnEcho('then commit the updated lockfile', '')).toBe(false)
  })
})

describe('EchoGuard', () => {
  /** A room that returns the reply at `coupling` of its level, for `frames` frames. */
  function learned(coupling: number, frames = 40): EchoGuard {
    const guard = new EchoGuard()
    for (let frame = 0; frame < frames; frame++) {
      const reply = 0.3 + 0.2 * Math.sin(frame / 3)
      guard.observe(reply * coupling, reply)
    }
    return guard
  }

  it('admits everything until it has heard enough of the reply', () => {
    const guard = learned(0.9, 10)
    expect(guard.isPerson(0.2, 0.5)).toBe(true)
  })

  it('holds the reply\'s own echo back, but not a voice clearly above it', () => {
    const guard = learned(0.9)
    // Echo at the level the room returns it.
    expect(guard.isPerson(0.45, 0.5)).toBe(false)
    // The person, much louder than the echo alone would be.
    expect(guard.isPerson(0.95, 0.5)).toBe(true)
  })

  it('changes nothing where the browser already cancels the echo', () => {
    // A well-cancelled room returns almost nothing, so ordinary speech passes.
    const guard = learned(0.05)
    expect(guard.isPerson(0.25, 0.5)).toBe(true)
  })

  it('admits everything while the reply is silent', () => {
    const guard = learned(0.9)
    expect(guard.isPerson(0.2, 0)).toBe(true)
  })

  it('cannot be taught that a loud person is echo', () => {
    // Someone talking from the first frame, much louder than the reply.
    const guard = new EchoGuard()
    for (let frame = 0; frame < 40; frame++) guard.observe(1, 0.2)
    // The ratio is capped, so a clearly louder voice still counts.
    expect(guard.isPerson(1, 0.2)).toBe(true)
  })

  it('forgets the room on reset', () => {
    const guard = learned(0.9)
    guard.reset()
    expect(guard.isPerson(0.45, 0.5)).toBe(true)
  })
})
