/** @vitest-environment jsdom */
import { lazy } from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { Deferred } from './Deferred'

afterEach(cleanup)
describe('content-preserving deferred rendering', () => {
  it('keeps the existing fallback on screen from the first render while loading', () => {
    const Waiting = lazy(() => new Promise<{ default: () => null }>(() => {}))
    render(<Deferred label="Enhancement" immediateFallback fallback={<pre>Existing code</pre>}><Waiting /></Deferred>)
    expect(screen.getByText('Existing code')).toBeTruthy()
  })
  it('retains the normal delayed placeholder policy for other deferred surfaces', () => {
    const Waiting = lazy(() => new Promise<{ default: () => null }>(() => {}))
    render(<Deferred label="Panel" fallback={<p>Loading panel</p>}><Waiting /></Deferred>)
    expect(screen.queryByText('Loading panel')).toBeNull()
  })
})
