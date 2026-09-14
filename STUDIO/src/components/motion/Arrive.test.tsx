/**
 * @vitest-environment jsdom
 */
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { Arrive, Arriving } from './Arrive'

/**
 * One entrance for everything that lands in the conversation, played only
 * where the turn says it is arriving now - a replayed history was already
 * here and must not settle in a hundred pieces at once.
 */

afterEach(cleanup)

function opacityOf(container: HTMLElement): string {
  return (container.firstElementChild as HTMLElement).style.opacity
}

describe('the entrance', () => {
  it('plays inside a live turn: the element starts unseen and rises in', () => {
    const { container } = render(
      <Arriving live>
        <Arrive>
          <p>words</p>
        </Arrive>
      </Arriving>,
    )
    expect(opacityOf(container)).toBe('0')
  })

  it('does not play in a replayed turn: the element is simply there', () => {
    const { container } = render(
      <Arriving live={false}>
        <Arrive>
          <p>words</p>
        </Arrive>
      </Arriving>,
    )
    expect(opacityOf(container)).not.toBe('0')
  })

  it('is off outside any turn, unless asked for by hand', () => {
    const bare = render(
      <Arrive>
        <p>words</p>
      </Arrive>,
    )
    expect(opacityOf(bare.container)).not.toBe('0')
    cleanup()
    const forced = render(
      <Arrive play>
        <p>words</p>
      </Arrive>,
    )
    expect(opacityOf(forced.container)).toBe('0')
  })
})
