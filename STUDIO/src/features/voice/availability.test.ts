/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it } from 'vitest'

import { voiceInputAvailable } from './availability'

/**
 * The secure-context read the composer and voice-mode both stand on. Stated
 * for both answers rather than trusting jsdom's default URL to stay what it
 * is: the fact under test is `isSecureContext`, not the test environment's
 * origin.
 */

afterEach(() => {
  // Whatever a test stamped on `window` comes off, so the next test meets
  // jsdom's own answer.
  Reflect.deleteProperty(window, 'isSecureContext')
})

describe('voiceInputAvailable', () => {
  it('is true on a secure origin', () => {
    Object.defineProperty(window, 'isSecureContext', { value: true, configurable: true })
    expect(voiceInputAvailable()).toBe(true)
  })

  it('is false on an insecure one', () => {
    Object.defineProperty(window, 'isSecureContext', { value: false, configurable: true })
    expect(voiceInputAvailable()).toBe(false)
  })

  it('is false when the browser does not say at all', () => {
    // No `isSecureContext` is not a secure context: the feature hides.
    expect(voiceInputAvailable()).toBe(false)
  })
})
